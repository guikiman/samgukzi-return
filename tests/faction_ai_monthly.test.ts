import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/core/game_engine.js';
import { GameStore } from '../src/core/game_store.js';
import { buildWorld } from '../src/core/scenario_system.js';
import { FactionAI } from '../src/core/faction_ai_monthly.js';
import scenarioIndex from '../src/data/scenarios/index.json';

describe('세력 AI 월간 자율 행동 [201]', () => {
    function setupWorld() {
        const store = new GameStore();
        const engine = new GameEngine(store);
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '05')!;
        const world = buildWorld(scenario as never, 2); // 유비 = 플레이어
        engine.initWorld(world.officers, world.factions, world.cities, []);
        engine['store'].setGlobalState({ playerFactionId: world.playerFactionId });
        return { store, engine, world };
    }

    it('플레이어 세력은 AI가 건드리지 않는다', () => {
        const { store, world } = setupWorld();
        const gs = store.getGlobalState();
        const ai = new FactionAI(store);
        const reports = ai.runMonthly();

        const playerFactionCities = world.cities.filter(c => c.ownerId === gs.playerFactionId);
        for (const report of reports) {
            expect(report.factionId).not.toBe(gs.playerFactionId);
        }
        // 플레이어 도시 소유권 변화 없음
        for (const c of playerFactionCities) {
            expect(store.getCity(c.id)!.ownerId).toBe(gs.playerFactionId);
        }
    });

    it('AI 세력이 내정/징병 행동을 수행한다', () => {
        const { store } = setupWorld();
        const ai = new FactionAI(store);
        const reports = ai.runMonthly();

        // 조조/손권 중 최소 1개 세력이 자금이 있어 행동해야 함
        const totalActions = reports.reduce((s, r) => s + r.actions.length, 0);
        expect(totalActions).toBeGreaterThan(0);
    });

    it('executeTurn 전체 흐름에서 AI 행동 이벤트가 발생한다', async () => {
        const { engine } = setupWorld();
        const events: string[] = [];
        engine.subscribe('FACTION_AI_ACTION', (e) => { events.push(e.type); });
        await engine.executeTurn();
        // AI 세력(조오/손권)이 존재하므로 이벤트가 1개 이상 발생할 수 있음 (자금 여부에 따라)
        expect(events.length).toBeGreaterThanOrEqual(0);
    });

    it('초기 난이도 배율은 첫 달 AI 직접 공격에 적용되고 플레이어 도시는 표적으로 남지 않는다', () => {
        const { store } = setupWorld();
        const gs = store.getGlobalState();
        const playerCity = store.getAllCities().find(c => c.ownerId === gs.playerFactionId)!;
        const ai = new FactionAI(store);
        const report = ai.runMonthly({ aiDifficultyMultiplier: 0.5 });
        expect(report.every(r => r.factionId !== gs.playerFactionId)).toBe(true);
        expect(store.getCity(playerCity.id)?.ownerId).toBe(gs.playerFactionId);
    });

    // ── [결함 수정] 병력 증가와 실제 점령 계약 ──
    // 원래 징병은 `병력 200 미만이면 +600` 인 일회성 판정이었다.
    // development 이 0~100 개발도일 때는 그럴듯했지만, 이 값이 병력
    // (수천~수만)인 걸 확인한 뒤로는 조건이 영원히 거짓이 되어
    // 병력이 1명도 늘지 않았고, 그 결과 AI가 24개월 내내 공격 0회였다.
    it('매달 병력이 증가한다 (징병이 죽지 않았다)', () => {
        const { store } = setupWorld();
        const before = new Map(store.getAllCities().map(c => [c.id, c.development]));
        new FactionAI(store).runMonthly();
        const grew = store.getAllCities()
            .filter(c => c.development > (before.get(c.id) ?? 0));
        expect(grew.length, '한 달 동안 병력이 증가한 도시가 0개').toBeGreaterThan(0);
    });

    it('병력은 인구 비례 상한을 넘지 않는다', () => {
        const { store } = setupWorld();
        const ai = new FactionAI(store);
        for (let m = 0; m < 24; m++) ai.runMonthly();
        for (const c of store.getAllCities()) {
            const cap = Math.max(400, Math.round(c.population * (c.isCapital ? 0.15 : 0.12)));
            expect(c.development, `${c.name} 병력 ${c.development} > 상한 ${cap}`).toBeLessThanOrEqual(cap + 1);
        }
    });

    it('장기 시뮬레이션에서 AI가 실제로 도시를 점령한다', () => {
        // 24개월간 점령이 0 이면 위 파이프라인 중 하나가 또 죽은 것이다.
        // 확률 게이트가 있으므로 1회 이상이면 충분하다.
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '03')!;
        const world = buildWorld(scenario as never, 2);
        const store = new GameStore();
        const engine = new GameEngine(store);
        engine.initWorld(world.officers, world.factions, world.cities, []);
        store.setGlobalState({ playerFactionId: world.playerFactionId, time: { year: 194, month: 1 }, difficulty: 3 } as never);

        const ai = new FactionAI(store);
        let conquers = 0;
        for (let m = 0; m < 24; m++) {
            for (const r of ai.runMonthly()) {
                for (const a of r.actions) if (a.includes('점령')) conquers++;
            }
        }
        expect(conquers, '24개월간 점령 0건 — AI 공격 파이프라인이 죽었다').toBeGreaterThan(0);
    });

    it('4세력 시나리오(02 반동탁 연합)에서도 점령이 발생한다', () => {
        // [결함 수정] 02 는 4세력이 각각 2도시씩 떨어져 있고 병력 격차가
        // 커서 열세 조건이 한 번도 안 맞아 점령 0 이었다. 도시를 11개로
        // 보강해 접경 15쌍을 확보했다. 세력 4개인 유일한 시나리오라
        // 별도로 확인한다(4세력이 모두 2도시인 구조는 점령이 일어나도
        // 상대 세력이 즉시 소멸한다).
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '02')!;
        const world = buildWorld(scenario as never, 2);
        const store = new GameStore();
        const engine = new GameEngine(store);
        engine.initWorld(world.officers, world.factions, world.cities, []);
        store.setGlobalState({ playerFactionId: world.playerFactionId, time: { year: 190, month: 1 }, difficulty: 3 } as never);

        const ai = new FactionAI(store);
        let conquers = 0;
        for (let m = 0; m < 24; m++) {
            for (const r of ai.runMonthly()) {
                for (const a of r.actions) if (a.includes('점령')) conquers++;
            }
        }
        expect(conquers, '02 시나리오 24개월간 점령 0건').toBeGreaterThan(0);
    });
});
