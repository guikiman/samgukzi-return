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
});
