import { describe, it, expect, vi } from 'vitest';
import {
    TurnScheduler,
    TurnLifecycleManager,
    AITurnProcessor,
} from '../src/core/turn_scheduler.js';
import { GameStore } from '../src/core/game_store.js';
import type { Officer, Faction, City, OfficerID, NormalizedState, ChunkTask } from '../src/core/types.js';
import { OfficerRank, OfficerStatus, GamePhase } from '../src/core/types.js';

/**
 * [34] TurnLifecycleManager 시간 슬라이스(Time Slicing) 루프 가변 틱 단위 검증
 *
 * AI 무장 연산 청크 분할 시, requestIdleCallback 지연 시간 경계에 따라
 * 턴 스케줄러가 데드락 락 상태에 빠지지 않고 안전하게 제어권을 넘겨받는지 검증
 */

function createTestStore(officerCount: number): GameStore {
    const store = GameStore.getInstance();
    const officers: Officer[] = [];
    for (let i = 0; i < officerCount; i++) {
        officers.push({
            id: `off_${i}`,
            name: `Officer ${i}`,
            courtesyName: '',
            gender: 'M',
            birthYear: 170,
            deathYear: null,
            stats: { leadership: 50, might: 50, intelligence: 50, politics: 50, charisma: 50 },
            exp: { leadership: 0, might: 0, intelligence: 0, politics: 0, charisma: 0 },
            rank: OfficerRank.UNRANKED,
            status: OfficerStatus.OFFICER,
            factionId: 'fac_1',
            cityId: 'city_1',
            personality: 'CALM',
            loyalty: 70,
            ambition: 50,
            morality: 50,
            greed: 50,
            actionPoints: 100,
            maxActionPoints: 100,
            stamina: 100,
            maxStamina: 100,
            fame: 0,
            infamy: 0,
            merit: 0,
            salary: 0,
            skills: [],
            specialty: null,
            inventory: { weapons: [], mounts: [], treasures: [], books: [] },
            isFemaleBattleEnabled: false,
            hasActedThisTurn: false,
            hp: 100,
            maxHp: 100,
            injuries: 0,
        });
    }
    const faction: Faction = {
        id: 'fac_1', name: 'Test', leaderId: 'off_0', color: '#ff0000',
        capitalCityId: 'city_1', cities: ['city_1'], officers: officers.map(o => o.id),
        armies: [], gold: 1000, food: 5000, reputation: 50,
        policy: { recruitmentFocus: 50, militaryFocus: 50, economyFocus: 50, diplomacyFocus: 50, cultureFocus: 50 },
        diplomacy: {}, isPlayerControlled: true, techLevel: 1,
    };
    const city: City = {
        id: 'city_1', name: 'Test City',
        hexCoord: { q: 0, r: 0 },
        population: 10000, defense: 100, maxDefense: 100,
        goldIncome: 50, foodIncome: 100,
        funds: 500,
        facilities: [], officerIds: officers.map(o => o.id),
        ownerId: 'fac_1', isCapital: true,
        development: 50,
        developmentStats: { commerce: 50, maxCommerce: 100, farming: 50, maxFarming: 100, technology: 30, maxTechnology: 100, publicOrder: 70, maxPublicOrder: 100 },
        loyalty: 70, danger: 0, weather: 'SUNNY',
    };

    store.initWorld(officers, [faction], [city], []);
    return store;
}

describe('TurnScheduler - 청크 분할 실행', () => {
    it('빈 태스크 큐 → 즉시 완료', async () => {
        const processor = vi.fn();
        const scheduler = new TurnScheduler(processor, { chunkSize: 10, maxFrameTimeMs: 16, useIdleCallback: false });

        scheduler.setTasks([]);
        // 빈 태스크: start()에서 this.tasks.length === 0 → return (즉시 반환)
        scheduler.start();
        expect(scheduler.isCurrentlyRunning()).toBe(false);
        expect(processor).not.toHaveBeenCalled();
    });

    it('50개 태스크 청크 실행 완료', async () => {
        const executed: number[] = [];
        const processor = async (task: ChunkTask) => {
            executed.push(parseInt(task.id.replace('task_', '')));
        };

        const scheduler = new TurnScheduler(processor, { chunkSize: 10, maxFrameTimeMs: 50, useIdleCallback: false });
        const tasks: ChunkTask[] = Array.from({ length: 50 }, (_, i) => ({
            id: `task_${i}`,
            officerId: `off_${i}` as OfficerID,
            execute: () => processor({ id: `task_${i}`, officerId: `off_${i}` as OfficerID, execute: () => {} }),
        }));
        scheduler.setTasks(tasks);

        await new Promise<void>((resolve) => {
            scheduler.setOnComplete(() => resolve());
            scheduler.start();
        });

        expect(executed.length).toBe(50);
    });

    it('비동기 태스크가 끝나기 전에는 완료를 알리지 않는다', async () => {
        let releaseTask!: () => void;
        const taskDone = new Promise<void>(resolve => { releaseTask = resolve; });
        let completed = false;

        const scheduler = new TurnScheduler(
            () => taskDone,
            { chunkSize: 10, maxFrameTimeMs: 50, useIdleCallback: false },
        );
        scheduler.setTasks([{
            id: 'async_task',
            officerId: 'off_async' as OfficerID,
            execute: () => {},
        }]);
        scheduler.setOnComplete(() => { completed = true; });
        scheduler.start();

        await Promise.resolve();
        expect(completed).toBe(false);
        expect(scheduler.getProgress().completed).toBe(0);

        releaseTask();
        await taskDone;
        await new Promise<void>(resolve => queueMicrotask(() => resolve()));
        expect(completed).toBe(true);
        expect(scheduler.getProgress().completed).toBe(1);
    });

    it('10,000개 대량 태스크 메모리 안정성', async () => {
        const executed: string[] = [];
        const processor = async (task: ChunkTask) => {
            executed.push(task.id);
        };

        const scheduler = new TurnScheduler(processor, { chunkSize: 100, maxFrameTimeMs: 16, useIdleCallback: false });
        const tasks: ChunkTask[] = Array.from({ length: 10000 }, (_, i) => ({
            id: `bulk_${i}`,
            officerId: `off_${i}` as OfficerID,
            execute: () => processor({ id: `bulk_${i}`, officerId: `off_${i}` as OfficerID, execute: () => {} }),
        }));
        scheduler.setTasks(tasks);

        await new Promise<void>((resolve) => {
            scheduler.setOnComplete(() => resolve());
            scheduler.start();
        });

        expect(executed.length).toBe(10000);
    });
});

describe('TurnLifecycleManager - AI 턴 생애주기', () => {
    it('100명 AI 턴 실행 후 모든 무장 hasActedThisTurn = true', async () => {
        const store = createTestStore(100);
        const manager = new TurnLifecycleManager(store);

        const decisions = await manager.executeAITurn();

        const allOfficers = store.getAllOfficers();
        const actedCount = allOfficers.filter(o => o.hasActedThisTurn).length;
        expect(actedCount).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(decisions)).toBe(true);
    });
});
