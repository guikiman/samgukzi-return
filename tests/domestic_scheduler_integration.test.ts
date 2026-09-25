import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/core/game_engine.js';
import { DomesticTaskType } from '../src/core/domestic_scheduler.js';
import { GameStore } from '../src/core/game_store.js';
import { buildWorld } from '../src/core/scenario_system.js';
import scenarioIndex from '../src/data/scenarios/index.json';

function createEngine() {
    const store = new GameStore();
    const engine = new GameEngine(store);
    const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '05')!;
    const world = buildWorld(scenario as never, 2);
    engine.initWorld(world.officers, world.factions, world.cities, []);
    store.setGlobalState({
        ...store.getGlobalState(),
        playerFactionId: world.playerFactionId,
        selectedOfficerId: world.factions.find(f => f.id === world.playerFactionId)?.leaderId ?? null,
    });
    return { engine, store, world };
}

describe('[49][76-85] 자동 내정 배정 통합', () => {
    it('등록된 임무는 도시 개발과 무장 행동력에 반영된다', () => {
        const { engine, store, world } = createEngine();
        const city = world.cities.find(c => c.ownerId === world.playerFactionId)!;
        const officer = store.getOfficersByCity(city.id).find(o => o.actionPoints >= 20)!;
        const before = store.getCity(city.id)!;
        const beforeFarming = before.developmentStats.farming;
        const beforeFunds = before.funds;
        const beforeAp = officer.actionPoints;

        engine.domesticScheduler.registerAssignment(city.id, {
            taskType: DomesticTaskType.FARMING,
            officerIds: [officer.id],
            allocatedFunds: 100,
        });
        const results = engine.domesticScheduler.executeAll();

        expect(results).toHaveLength(1);
        expect(results[0].taskType).toBe(DomesticTaskType.FARMING);
        expect(store.getCity(city.id)!.developmentStats.farming).toBeGreaterThan(beforeFarming);
        expect(store.getCity(city.id)!.funds).toBe(beforeFunds - 100);
        expect(store.getOfficer(officer.id)!.actionPoints).toBe(beforeAp - 20);
    });

    it('게임 엔진 턴 종료가 자동 내정 결과를 이벤트로 발행한다', async () => {
        const { engine, store, world } = createEngine();
        const city = world.cities.find(c => c.ownerId === world.playerFactionId)!;
        const officer = store.getOfficersByCity(city.id).find(o => o.actionPoints >= 20)!;
        engine.domesticScheduler.registerAssignment(city.id, {
            taskType: DomesticTaskType.COMMERCE,
            officerIds: [officer.id],
            allocatedFunds: 100,
        });

        let completed = 0;
        engine.subscribe('DOMESTIC_ASSIGNMENT_COMPLETED', () => { completed++; });
        await engine.executeTurn();

        expect(completed).toBe(1);
        expect(engine.domesticScheduler.pendingCount).toBe(0);
    });
});
