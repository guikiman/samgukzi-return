import { describe, it, expect } from 'vitest';
import { GameEngine } from '../src/core/game_engine.js';
import { GameStore } from '../src/core/game_store.js';
import { buildWorld } from '../src/core/scenario_system.js';
import { GamePhase } from '../src/core/types.js';
import scenarioIndex from '../src/data/scenarios/index.json';

describe('턴 진행 시 플레이어 영토 무결성 [201]', () => {
    it('5턴 진행 후에도 플레이어 도시 소유권은 유지된다', async () => {
        const store = new GameStore();
        const engine = new GameEngine(store);
        const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '05')!;
        const world = buildWorld(scenario as never, 2);
        engine.initWorld(world.officers, world.factions, world.cities, []);

        const gs = store.getGlobalState();
        const playerCityIds = world.cities.filter(c => c.ownerId === gs.playerFactionId).map(c => c.id);

        for (let i = 0; i < 5; i++) {
            await engine.executeTurn();
            expect(engine.getCurrentPhase()).toBe(GamePhase.WORLD_MAP);
        }

        for (const id of playerCityIds) {
            expect(store.getCity(id)!.ownerId).toBe(gs.playerFactionId);
        }
        // 시간 진행 확인
        expect(store.getGlobalState().turnCount).toBeGreaterThanOrEqual(5);
    });
});
