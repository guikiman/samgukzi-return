import { describe, expect, it, vi } from 'vitest';
import { GameEngine } from '../src/core/game_engine.js';
import { GameStore } from '../src/core/game_store.js';
import { buildWorld } from '../src/core/scenario_system.js';
import type { AIDecision } from '../src/core/types.js';
import scenarioIndex from '../src/data/scenarios/index.json';
import { getCaptivesInCity } from '../src/core/captive_escape_system.js';

function setup() {
    const store = new GameStore();
    const engine = new GameEngine(store);
    const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '05')!;
    const world = buildWorld(scenario as never, 0);
    engine.initWorld(world.officers, world.factions, world.cities, []);
    store.setGlobalState({ playerFactionId: 'fac_0' });
    return { engine, store };
}

function convert(engine: GameEngine, decision: AIDecision): void {
    (engine as unknown as { convertDecisionToCommand(decision: AIDecision): void }).convertDecisionToCommand(decision);
}

describe('AI 스트리밍 결정 → CommandQueue [201]', () => {
    it('targetCityId 내정 결정을 큐에서 실행한다', () => {
        const { engine, store } = setup();
        const officer = store.getAllOfficers().find(o => o.factionId === 'fac_1' && o.cityId)!;
        const city = store.getCity(officer.cityId!)!;
        const before = city.development;

        convert(engine, {
            officerId: officer.id,
            actionType: 'DOMESTIC',
            priority: 1,
            reasoning: 'test',
            payload: { targetCityId: city.id },
        });
        expect(engine.getPendingCommandCount()).toBe(1);
        const result = engine.executeAllCommands();
        expect(result[0]?.success).toBe(true);
        expect(store.getCity(city.id)!.development).toBeGreaterThan(before);
    });

    it('도시 징병 결정을 큐에서 실행한다', () => {
        const { engine, store } = setup();
        const officer = store.getAllOfficers().find(o => o.factionId === 'fac_1' && o.cityId)!;
        const city = store.getCity(officer.cityId!)!;
        store.updateCity(city.id, { development: 100, funds: 500 });
        const before = { development: 100, funds: 500 };

        convert(engine, {
            officerId: officer.id,
            actionType: 'RECRUITMENT',
            priority: 1,
            reasoning: 'test',
            payload: { targetCityId: city.id },
        });
        expect(engine.getPendingCommandCount()).toBe(1);
        expect(engine.executeAllCommands()[0]?.success).toBe(true);
        expect(store.getCity(city.id)).toMatchObject({ development: 700, funds: 300 });
        expect(before.development).toBe(100);
    });

    it('BATTLE 결정을 자동 전투로 실행하고 승리 시 도시를 점령한다', () => {
        const { engine, store } = setup();
        const officer = store.getAllOfficers().find(o => o.factionId === 'fac_1' && o.cityId)!;
        const source = store.getCity(officer.cityId!)!;
        const target = store.getAllCities().find(c =>
            c.ownerId && c.ownerId !== 'fac_1' && c.ownerId !== 'fac_0'
            && store.getOfficersByCity(c.id).some(o => o.factionId !== null),
        )!;
        store.updateOfficer(officer.id, { hasActedThisTurn: false, actionPoints: 100 });
        store.updateCity(source.id, { development: 99_999, defense: 100 });
        store.updateCity(target.id, { development: 1, defense: 1, loyalty: 30 });
        const attackerFaction = store.getFaction('fac_1')!;
        const defenderFaction = store.getFaction(target.ownerId!)!;
        const capturedBefore = store.getOfficersByCity(target.id)
            .filter(o => o.factionId !== null);
        store.updateFaction(attackerFaction.id, {
            diplomacy: { ...attackerFaction.diplomacy, [defenderFaction.id]: { relation: -100, treaty: 'WAR', duration: 1 } },
        });
        store.updateFaction(defenderFaction.id, {
            diplomacy: { ...defenderFaction.diplomacy, [attackerFaction.id]: { relation: -100, treaty: 'WAR', duration: 1 } },
        });

        const random = vi.spyOn(Math, 'random').mockReturnValue(0);
        convert(engine, {
            officerId: officer.id,
            actionType: 'BATTLE',
            priority: 1,
            reasoning: 'test siege',
            payload: { targetCityId: target.id },
        });
        expect(engine.getPendingCommandCount()).toBe(1);
        const result = engine.executeAllCommands()[0];
        expect(result?.success).toBe(true);
        expect(result?.commandType).toBe('BATTLE');
        expect(result?.logMessages?.some(message => message.includes('포획'))).toBe(true);
        expect(result?.captiveOutcomes?.length).toBeGreaterThan(0);
        expect(engine.getCommandReplayLog().some(event => event.action === 'EXECUTE' && event.commandType === 'BATTLE')).toBe(true);
        expect(engine.peekMonthlyPortedLog().captives.length).toBeGreaterThan(0);
        expect(engine.chronicle.listByKind('CAPTURE').length).toBeGreaterThan(0);
        expect(store.getCity(target.id)!.ownerId).toBe('fac_1');
        expect(store.getCity(source.id)!.development).toBeLessThan(99_999);
        expect(store.getOfficer(officer.id)!.actionPoints).toBe(70);
        // 포획된 포로는 BattleCommand 내부에서 즉시 등용·처형·석방된다. [121-130]
        expect(getCaptivesInCity(store, source.id)).toHaveLength(0);
        expect(engine.undoLastCommand()).toBe(true);
        expect(engine.getCommandReplayLog().some(event => event.action === 'UNDO')).toBe(true);
        expect(store.getCity(target.id)!.ownerId).not.toBe('fac_1');
        expect(store.getOfficer(officer.id)!.actionPoints).toBe(100);
        expect(engine.chronicle.listByKind('CAPTURE')).toHaveLength(0);
        expect(engine.peekMonthlyPortedLog().captives).toHaveLength(0);
        if (capturedBefore.length > 0) {
            expect(capturedBefore.every(id => store.getOfficer(id)?.factionId !== null)).toBe(true);
        }
        expect(engine.redoLastCommand()).toBe(true);
        expect(engine.getCommandReplayLog().some(event => event.action === 'REDO')).toBe(true);
        expect(engine.chronicle.listByKind('CAPTURE').length).toBeGreaterThan(0);
        random.mockRestore();
    });

    it('DIPLOMACY 결정을 실행하고 세력 diplomatic 상태까지 동기화한다', () => {
        const { engine, store } = setup();
        const officer = store.getAllOfficers().find(o => o.factionId === 'fac_1')!;
        const targetFaction = store.getFaction('fac_2')!;
        const oldTreaty = store.getFaction('fac_1')!.diplomacy[targetFaction.id];
        store.updateOfficer(officer.id, { hasActedThisTurn: false, actionPoints: 100 });

        convert(engine, {
            officerId: officer.id,
            actionType: 'DIPLOMACY',
            priority: 1,
            reasoning: 'test alliance',
            payload: { targetFactionId: targetFaction.id, action: 'ALLIANCE' },
        });
        expect(engine.getPendingCommandCount()).toBe(1);
        expect(engine.executeAllCommands()[0]?.success).toBe(true);
        expect(engine.diplomacyEngine.getRelation('fac_1', targetFaction.id)).toBe('alliance');
        expect(store.getFaction('fac_1')!.diplomacy[targetFaction.id]?.treaty).toBe('ALLIANCE');
        expect(store.getFaction(targetFaction.id)!.diplomacy.fac_1?.treaty).toBe('ALLIANCE');
        expect(store.getOfficer(officer.id)!.actionPoints).toBe(90);
        expect(engine.undoLastCommand()).toBe(true);
        expect(engine.diplomacyEngine.getRelation('fac_1', targetFaction.id)).not.toBe('alliance');
        expect(store.getFaction('fac_1')!.diplomacy[targetFaction.id]).toEqual(oldTreaty);
    });

    it('비전쟁 도시 공격과 플레이어 결정은 큐에 넣지 않는다', () => {
        const { engine, store } = setup();
        const playerOfficer = store.getAllOfficers().find(o => o.factionId === 'fac_0')!;
        const npcOfficer = store.getAllOfficers().find(o => o.factionId === 'fac_1')!;

        convert(engine, {
            officerId: playerOfficer.id,
            actionType: 'REST',
            priority: 1,
            reasoning: 'player',
            payload: {},
        });
        convert(engine, {
            officerId: npcOfficer.id,
            actionType: 'BATTLE',
            priority: 1,
            reasoning: 'invalid target',
            payload: { targetCityId: 'city_없는도시' },
        });
        const enemyCity = store.getAllCities().find(c => c.ownerId && c.ownerId !== npcOfficer.factionId && c.ownerId !== 'fac_0');
        if (enemyCity && enemyCity.ownerId && npcOfficer.factionId) {
            store.updateOfficer(npcOfficer.id, { hasActedThisTurn: false });
            const attacker = store.getFaction(npcOfficer.factionId)!;
            const defender = store.getFaction(enemyCity.ownerId)!;
            store.updateFaction(attacker.id, {
                diplomacy: { ...attacker.diplomacy, [defender.id]: { relation: 0, treaty: 'CEASEFIRE', duration: 1 } },
            });
            store.updateFaction(defender.id, {
                diplomacy: { ...defender.diplomacy, [attacker.id]: { relation: 0, treaty: 'CEASEFIRE', duration: 1 } },
            });
            convert(engine, {
                officerId: npcOfficer.id,
                actionType: 'BATTLE',
                priority: 1,
                reasoning: 'not at war',
                payload: { targetCityId: enemyCity.id },
            });
        }

        expect(engine.getPendingCommandCount()).toBe(0);
        expect(store.getOfficer(npcOfficer.id)!.hasActedThisTurn).toBe(false);
    });
});
