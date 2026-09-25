import { describe, it, expect, vi } from 'vitest';
import { GameEngine } from '../src/core/game_engine.js';
import { GameStore } from '../src/core/game_store.js';
import { loadScenarios, buildWorld } from '../src/core/scenario_system.js';
import type { ScenarioData } from '../src/core/scenario_system.js';
import scenarioIndex from '../src/data/scenarios/index.json';
import { OfficerLoyaltySystem } from '../src/core/officer_loyalty_system.js';
import { assembleReinforcements } from '../src/core/reinforcement_system.js';
import { SaveCompressor } from '../src/core/save_compressor.js';
import { BattleCommand } from '../src/core/command_system.js';

/**
 * 세이브/로드 라운드트립 호환성 검증 [17]
 * - 새 시스템 상태(충성도/소속/멸망/증원 산출 기반 데이터) 저장 → 복원 후 동일성 확인
 * - 복원 직후 전도 도시 뷰 재동기화에 필요한 데이터(도시/세력/무장) 무결성 확인
 */

function makeWorld() {
    const store = new GameStore();
    const engine = new GameEngine(store);
    const scenarios = scenarioIndex as ScenarioData[];
    const world = buildWorld(scenarios.find(s => s.id === '05')!, 2); // 삼분천하, 유비
    engine.initWorld(world.officers, world.factions, world.cities, []);
    store.setGlobalState({
        ...store.getGlobalState(),
        playerFactionId: world.playerFactionId,
    });
    return { store, engine, world };
}

describe('세이브/로드 라운드트립 [17]', () => {
    it('저장 → 복원 후 세력/도시/무장 수가 동일하다', () => {
        const { store, engine, world } = makeWorld();
        store.setGlobalState({ ...store.getGlobalState(), currentYear: 208, currentMonth: 5 });

        const save = engine.saveCompressed();
        expect(save).toBeTruthy();

        const store2 = new GameStore();
        const engine2 = new GameEngine(store2);
        expect(engine2.loadCompressed(save)).toBe(true);

        const gs1 = store.getGlobalState();
        const gs2 = store2.getGlobalState();
        expect(gs2.currentYear).toBe(208);
        expect(gs2.currentMonth).toBe(5);
        expect(gs2.playerFactionId).toBe(world.playerFactionId);

        expect(Object.keys(store2.getState().cities)).toHaveLength(world.cities.length);
        expect(Object.keys(store2.getState().officers)).toHaveLength(world.officers.length);
        expect(Object.keys(store2.getState().factions)).toHaveLength(world.factions.length);
    });

    it('전투 후처리 연대기 기록이 압축 세이브/로드 후 보존된다', () => {
        const { store, engine } = makeWorld();
        engine.chronicle.add('CAPTURE', '테스트 포로 처분 기록');

        const store2 = new GameStore();
        const engine2 = new GameEngine(store2);
        expect(engine2.loadCompressed(engine.saveCompressed())).toBe(true);
        expect(engine2.chronicle.listByKind('CAPTURE').map(entry => entry.text)).toContain('테스트 포로 처분 기록');
    });

    it('복원 후 충성도·소속 변경이 보존된다', () => {
        const { store, engine, world } = makeWorld();

        // 등용으로 무장 소속 변경 시뮬레이션 (성공 보장: 직접 updateOfficer)
        const playerCity = world.cities.find(c => c.ownerId === world.playerFactionId)!;
        const target = Object.values(store.getState().officers).find(
            o => o.factionId && o.factionId !== world.playerFactionId,
        );
        expect(target).toBeTruthy();
        if (target) {
            store.updateOfficer(target.id, {
                factionId: world.playerFactionId,
                cityId: playerCity.id,
                loyalty: 55,
            });
        }

        const save = engine.saveCompressed();
        const store2 = new GameStore();
        const engine2 = new GameEngine(store2);
        expect(engine2.loadCompressed(save)).toBe(true);

        const restored = store2.getOfficer(target!.id);
        expect(restored?.factionId).toBe(world.playerFactionId);
        expect(restored?.loyalty).toBe(55);
    });

    it('승리한 전투 커맨드는 저장·로드 후 재실행되지 않고 undo 이력도 초기화된다', () => {
        const { store, engine } = makeWorld();
        const attacker = store.getAllOfficers().find(o => o.factionId === 'fac_1' && o.cityId)!;
        const source = store.getCity(attacker.cityId!)!;
        const target = store.getAllCities().find(c =>
            c.ownerId && c.ownerId !== 'fac_1' && c.ownerId !== 'fac_0'
            && store.getOfficersByCity(c.id).some(o => o.factionId !== null),
        )!;
        const defenderFaction = store.getFaction(target.ownerId!)!;
        store.updateOfficer(attacker.id, { actionPoints: 100 });
        store.updateCity(source.id, { development: 99_999, defense: 100 });
        store.updateCity(target.id, { development: 1, defense: 1, loyalty: 30 });
        store.updateFaction('fac_1', {
            diplomacy: { ...store.getFaction('fac_1')!.diplomacy, [defenderFaction.id]: { relation: -100, treaty: 'WAR', duration: 1 } },
        });
        store.updateFaction(defenderFaction.id, {
            diplomacy: { ...defenderFaction.diplomacy, fac_1: { relation: -100, treaty: 'WAR', duration: 1 } },
        });

        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        try {
            engine.enqueueCommand(new BattleCommand(attacker.id, source.id, target.id, 0));
            expect(engine.executeAllCommands()[0]?.success).toBe(true);
            const conqueredOwner = store.getCity(target.id)!.ownerId;
            const replayLogLength = engine.getCommandReplayLog().length;

            const store2 = new GameStore();
            const engine2 = new GameEngine(store2);
            expect(engine2.loadCompressed(engine.saveCompressed())).toBe(true);
            expect(store2.getCity(target.id)!.ownerId).toBe(conqueredOwner);
            expect(engine2.getCommandReplayLog()).toHaveLength(replayLogLength);
            // 실행 완료 명령은 pending으로 재적재되지 않아야 한다.
            expect(engine2.getPendingCommandCount()).toBe(0);
            expect(engine2.canUndo()).toBe(false);
        } finally {
            random.mockRestore();
        }
    });

    it('방문 도시 기록이 압축 세이브/로드 후 보존된다', () => {
        const { store, engine, world } = makeWorld();
        const visited = [world.cities[0].id, world.cities[1].id];
        store.setGlobalState({ ...store.getGlobalState(), visitedCityIds: visited });

        const save = engine.saveCompressed();
        const store2 = new GameStore();
        const engine2 = new GameEngine(store2);
        expect(engine2.loadCompressed(save)).toBe(true);
        expect(store2.getGlobalState().visitedCityIds).toEqual(visited);
    });

    it('건물 운영 상태가 압축 세이브/로드 후 보존된다', () => {
        const { store, engine, world } = makeWorld();
        const cityId = world.cities[0].id;
        store.setGlobalState({
            cityBuildingStates: {
                [cityId]: {
                    [`${cityId}:0`]: { buildingId: `${cityId}:0`, level: 4, investment: 360, active: false },
                },
            },
        });

        const store2 = new GameStore();
        const engine2 = new GameEngine(store2);
        expect(engine2.loadCompressed(engine.saveCompressed())).toBe(true);
        expect(store2.getGlobalState().cityBuildingStates?.[cityId]?.[`${cityId}:0`]).toEqual({
            buildingId: `${cityId}:0`, level: 4, investment: 360, active: false,
        });
    });

    it('방문 기록이 없는 구버전 세이브도 로드할 수 있다', () => {
        const { store, engine } = makeWorld();
        const save = JSON.parse(new SaveCompressor().decompress(engine.saveCompressed()));
        delete save.globalState.visitedCityIds;

        const store2 = new GameStore();
        const engine2 = new GameEngine(store2);
        expect(engine2.loadCompressed(JSON.stringify(save))).toBe(true);
        expect(store2.getGlobalState().visitedCityIds).toBeUndefined();
    });

    it('복원 후 인접 아군 도시 증원 산출이 동일하게 동작한다', () => {
        const { store, engine } = makeWorld();
        const save = engine.saveCompressed();
        const store2 = new GameStore();
        const engine2 = new GameEngine(store2);
        engine2.loadCompressed(save);

        // 복원된 월드에서 증원 편성 재산출 — 예외 없이 수행되어야 함
        const st = store2.getState();
        const cities = Object.values(st.cities);
        const defenders = cities.filter(c => c.ownerId);
        expect(defenders.length).toBeGreaterThan(0);

        for (const c of defenders) {
            expect(() =>
                assembleReinforcements(c.id, c.ownerId!, cities, Object.values(st.officers), Object.values(st.armies)),
            ).not.toThrow();
        }
    });

    it('복원 직후 전도 동기화에 필요한 뷰 데이터가 유효하다', () => {
        const { engine } = makeWorld();
        const save = engine.saveCompressed();
        const store2 = new GameStore();
        const engine2 = new GameEngine(store2);
        expect(engine2.loadCompressed(save)).toBe(true);

        // syncChinaMapCities가 요구하는 형태: id/name/ownerId/mapX/mapY
        for (const c of Object.values(store2.getState().cities)) {
            expect(typeof c.id).toBe('string');
            expect(typeof c.name).toBe('string');
            expect(c.mapX).toBeTypeOf('number');
            expect(c.mapY).toBeTypeOf('number');
            expect(c.mapX!).toBeGreaterThanOrEqual(0);
            expect(c.mapX!).toBeLessThanOrEqual(1);
        }
    });
});

describe('SaveCompressor 무결성 [4][17]', () => {
    it('압축·복원 후 원본 JSON이 일치한다', () => {
        const compressor = new SaveCompressor();
        const original = JSON.stringify({ text: '삼국지 테스트', nested: { value: 42 }, unicode: '漢字' });
        const compressed = compressor.compress(original);
        expect(compressor.isCompressed(compressed)).toBe(true);
        expect(compressor.decompress(compressed)).toBe(original);
    });

    it('잘린 압축 데이터는 오류로 거부한다', () => {
        const compressor = new SaveCompressor();
        const compressed = compressor.compress('반복되는 데이터 '.repeat(100));
        expect(() => compressor.decompress(compressed.slice(0, -1))).toThrow();
    });
});
