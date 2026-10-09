import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/core/game_engine.js';
import { GameStore } from '../src/core/game_store.js';
import { buildWorld } from '../src/core/scenario_system.js';
import { FactionFateSystem } from '../src/core/faction_fate_system.js';
import { OfficerLoyaltySystem } from '../src/core/officer_loyalty_system.js';
import { MonthlyReportSystem } from '../src/core/monthly_report.js';
import scenarioIndex from '../src/data/scenarios/index.json';

describe('세력 운명 시스템 [213]', () => {
    function setupWorld() {
        const store = new GameStore();
        const engine = new GameEngine(store);
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '05')!;
        const world = buildWorld(scenario as never, 2);
        engine.initWorld(world.officers, world.factions, world.cities, []);
        store.setGlobalState({ playerFactionId: world.playerFactionId });
        return { store, engine, world };
    }

    it('모든 도시를 잃은 세력은 멸망 판정된다', () => {
        const { store, world } = setupWorld();
        const fate = new FactionFateSystem(store);

        // 조오(fac_0)의 도시를 모두 무주공산으로
        for (const city of world.cities.filter(c => c.ownerId === 'fac_0')) {
            store.updateCity(city.id, { ownerId: null });
        }

        const report = fate.checkFates();
        expect(report.destroyedFactionIds).toContain('fac_0');
        expect(report.ending).toBeNull(); // 아직 3세력 생존
    });

    it('한 세력이 모든 도시를 점령하면 통일 엔딩이 발생한다', () => {
        const { store, world } = setupWorld();
        const fate = new FactionFateSystem(store);

        // 모든 도시를 유비(fac_2) 소유로
        for (const city of world.cities) {
            store.updateCity(city.id, { ownerId: 'fac_2' });
        }

        const report = fate.checkFates();
        // 조오/손권은 도시가 없어 멸망
        expect(report.destroyedFactionIds).toContain('fac_0');
        expect(report.destroyedFactionIds).toContain('fac_1');
        expect(report.ending).toBe('PLAYER_UNIFICATION');
        expect(report.winnerFactionName).toBe('유비');
    });

    it('AI 세력이 통일하면 AI_UNIFICATION 엔딩이다', () => {
        const { store, world } = setupWorld();
        const gs = store.getGlobalState();
        const fate = new FactionFateSystem(store);

        for (const city of world.cities) {
            store.updateCity(city.id, { ownerId: 'fac_0' });
        }
        const report = fate.checkFates();
        expect(report.ending).toBe('AI_UNIFICATION');
        expect(gs.playerFactionId).not.toBe('fac_0');
    });
});

describe('무장 등용/배신 [24]', () => {
    function setupWorld() {
        const store = new GameStore();
        const engine = new GameEngine(store);
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '05')!;
        const world = buildWorld(scenario as never, 2);
        engine.initWorld(world.officers, world.factions, world.cities, []);
        store.setGlobalState({ playerFactionId: world.playerFactionId });
        return { store, engine, world };
    }

    it('재야 무장을 등용하면 세력에 합류한다', () => {
        const { store, world } = setupWorld();
        const loyalty = new OfficerLoyaltySystem(store);
        const playerCity = world.cities.find(c => c.ownerId === 'fac_2')!;

        // 재야 무장 확보 (없으면 무장 하나를 재야로 전환)
        let freeOfficer = store.getAllOfficers().find(o => o.factionId === null);
        if (!freeOfficer) {
            const victim = store.getAllOfficers().find(o => o.factionId === 'fac_0')!;
            store.updateOfficer(victim.id, { factionId: null, status: 'FREE' });
            freeOfficer = store.getOfficer(victim.id)!;
        }

        const result = loyalty.recruit(freeOfficer.id, 'fac_2', playerCity.id, 'liu_bei');
        if (result.success) {
            expect(store.getOfficer(freeOfficer.id)!.factionId).toBe('fac_2');
            // 스토어 live 상태 기준으로 확인 (world.cities는 초기 스냅숏 참조)
            expect(store.getCity(playerCity.id)!.officerIds).toContain(freeOfficer.id);
        } else {
            // 실패해도 소속은 재야 유지
            expect(store.getOfficer(freeOfficer.id)!.factionId).toBeNull();
        }
    });

    it('자기 세력 무장은 등용할 수 없다', () => {
        const { store, world } = setupWorld();
        const loyalty = new OfficerLoyaltySystem(store);
        const playerCity = world.cities.find(c => c.ownerId === 'fac_2')!;
        const ownOfficer = store.getAllOfficers().find(o => o.factionId === 'fac_2')!;

        const result = loyalty.recruit(ownOfficer.id, 'fac_2', playerCity.id);
        expect(result.success).toBe(false);
    });

    it('충성도가 낮은 AI 무장은 이탈할 수 있다', () => {
        const { store } = setupWorld();
        const loyalty = new OfficerLoyaltySystem(store);

        // 조오 무장의 충성도를 0으로 강하 → 이탈 확률 최대
        const target = store.getAllOfficers().find(o => o.factionId === 'fac_0')!;
        store.updateOfficer(target.id, { loyalty: 0 });

        // 여러 달 반복해 이탈 또는 유지 어느 쪽이든 크래시 없음 확인
        for (let i = 0; i < 20; i++) {
            loyalty.processMonthlyDefections();
        }
        // 상태 무결성: 모든 무장의 factionId는 실제 세력이거나 null
        const factionIds = new Set(store.getAllFactions().map(f => f.id));
        for (const o of store.getAllOfficers()) {
            if (o.factionId) expect(factionIds.has(o.factionId)).toBe(true);
        }
    });
});

describe('월간 보고서 [E1-361]', () => {
    it('플레이어 세력 재정과 도시 현황을 요약한다', () => {
        const store = new GameStore();
        const engine = new GameEngine(store);
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '05')!;
        const world = buildWorld(scenario as never, 2);
        engine.initWorld(world.officers, world.factions, world.cities, []);
        store.setGlobalState({ playerFactionId: world.playerFactionId });

        const report = new MonthlyReportSystem(store).generate();
        expect(report.cities.length).toBeGreaterThan(0);
        expect(report.factions.length).toBe(3); // 조조 + 손권 + 유장
        expect(report.playerGold).toBeGreaterThanOrEqual(0);
        expect(report.cities[0].name).toBeTruthy();
    });
});
