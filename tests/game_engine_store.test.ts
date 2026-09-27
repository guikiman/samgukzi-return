/**
 * Phase 4-1: 게임 엔진 코어 테스트 (game_engine.ts, game_store.ts, turn_scheduler.ts)
 */
import { describe, it, expect, beforeEach, vi, beforeAll } from 'vitest';
import { GameStore, gameStore } from '../src/core/game_store.js';
import { GameEngine, getGameEngine } from '../src/core/game_engine.js';
import { DomesticCommand } from '../src/core/command_system.js';
import { TurnScheduler, AITurnProcessor, TurnLifecycleManager } from '../src/core/turn_scheduler.js';
import {
    GamePhase, Officer, Faction, City, Army, OfficerID, FactionID, CityID,
    RelationshipEdge, ChunkTask,
} from '../src/core/types.js';
import type { NormalizedState, GlobalState } from '../src/core/types.js';

// ============================================================
// 헬퍼: 테스트용 기본 엔티티 생성
// ============================================================
function makeOfficer(id: string, overrides: Partial<Officer> = {}): Officer {
    return {
        id, name: `Officer_${id}`, courtesyName: '', gender: 'M',
        birthYear: 170, deathYear: null,
        stats: { leadership: 80, might: 70, intelligence: 60, politics: 50, charisma: 90 },
        exp: { leadership: 0, might: 0, intelligence: 0, politics: 0, charisma: 0 },
        rank: 5, status: 'OFFICER' as any, factionId: 'f1', cityId: 'c1',
        personality: 'CALM', loyalty: 80, ambition: 50, morality: 50, greed: 30,
        actionPoints: 100, maxActionPoints: 100, stamina: 100, maxStamina: 100,
        fame: 0, infamy: 0, merit: 0, salary: 20,
        skills: [], specialty: null,
        inventory: { weapons: [], mounts: [], treasures: [], books: [] },
        isFemaleBattleEnabled: false, hasActedThisTurn: false,
        hp: 100, maxHp: 100, injuries: 0,
        ...overrides,
    };
}

function makeFaction(id: string, overrides: Partial<Faction> = {}): Faction {
    return {
        id, name: `Faction_${id}`, leaderId: 'o1', color: '#ff0000',
        capitalCityId: 'c1', cities: ['c1'], officers: ['o1'], armies: [],
        gold: 1000, food: 5000, reputation: 50,
        policy: { recruitmentFocus: 0.5, militaryFocus: 0.5, economyFocus: 0.5, diplomacyFocus: 0.5, cultureFocus: 0.5 },
        diplomacy: {},
        isPlayerControlled: false, techLevel: 1,
        ...overrides,
    };
}

function makeCity(id: string, overrides: Partial<City> = {}): City {
    return {
        id, name: `City_${id}`, hexCoord: { q: 0, r: 0 },
        population: 10000, defense: 50, maxDefense: 100,
        goldIncome: 100, foodIncome: 200, funds: 500,
        facilities: [], officerIds: [], ownerId: 'f1',
        isCapital: false, development: 50,
        developmentStats: {
            commerce: 50, maxCommerce: 100,
            farming: 50, maxFarming: 100,
            technology: 50, maxTechnology: 100,
            publicOrder: 50, maxPublicOrder: 100,
        },
        loyalty: 70, danger: 0, weather: 'SUNNY',
        ...overrides,
    };
}

function makeArmy(id: string, overrides: Partial<Army> = {}): Army {
    return {
        id, commanderId: 'o1', officerIds: ['o1'],
        soldiers: 10000, morale: 80, training: 60, supplies: 100,
        originCityId: 'c1', targetCityId: null, position: null, banner: 'A',
        ...overrides,
    };
}

/** 싱글톤 GameStore의 상태를 초기화 */
function resetStore(store: GameStore): void {
    const emptyState: NormalizedState = {
        officers: {}, factions: {}, cities: {}, armies: {}, relationships: {},
        byFaction: { officers: {}, cities: {}, armies: {} },
        byCity: { officers: {} },
        byOfficer: { relationships: {} },
    };
    const defaultGlobal: GlobalState = {
        phase: GamePhase.TITLE,
        time: { year: 192, month: 1 },
        season: 'WINTER', weather: 'SUNNY',
        turnCount: 0, selectedOfficerId: null, playerFactionId: null,
    };
    // Direct property assignment to bypass private
    Object.assign(store, {
        state: JSON.parse(JSON.stringify(emptyState)),
        globalState: JSON.parse(JSON.stringify(defaultGlobal)),
        listeners: new Set(),
    });
}

function getInitializedStore(): GameStore {
    const s = GameStore.getInstance();
    resetStore(s);
    return s;
}

// ============================================================
// GameStore 테스트
// ============================================================
describe('GameStore', () => {
    let store: GameStore;

    beforeEach(() => {
        store = getInitializedStore();
    });

    it('getInstance returns singleton', () => {
        const a = GameStore.getInstance();
        const b = GameStore.getInstance();
        expect(a).toBe(b);
    });

    it('addOfficer and getOfficer O(1) lookup', () => {
        const o = makeOfficer('o1');
        store.addOfficer(o);
        expect(store.getOfficer('o1')).toEqual(o);
        expect(store.getOfficer('nonexistent')).toBeNull();
    });

    it('updateOfficer updates state and notifies', () => {
        const o = makeOfficer('o1');
        store.addOfficer(o);
        const listener = vi.fn();
        store.subscribe(listener);
        store.updateOfficer('o1', { loyalty: 90 });
        expect(store.getOfficer('o1')!.loyalty).toBe(90);
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('updateOfficer with nonexistent id does nothing', () => {
        store.updateOfficer('nonexistent', { loyalty: 90 });
        expect(store.getOfficer('nonexistent')).toBeNull();
    });

    it('updateFaction updates state', () => {
        const f = makeFaction('f1');
        store.initWorld([], [f], [], []);
        store.updateFaction('f1', { gold: 2000 });
        expect(store.getFaction('f1')!.gold).toBe(2000);
    });

    it('updateCity updates state and reindexes on owner change', () => {
        const f1 = makeFaction('f1');
        const f2 = makeFaction('f2', { id: 'f2', leaderId: 'o2', cities: [], officers: []});
        const c = makeCity('c1', { ownerId: 'f1' });
        store.initWorld([], [f1, f2], [c], []);
        store.updateCity('c1', { ownerId: 'f2' });
        expect(store.getCity('c1')!.ownerId).toBe('f2');
        // faction.cities array IS updated but byFaction index is not (pre-existing)
        expect(store.getFaction('f2')!.cities).toContain('c1');
        expect(store.getFaction('f1')!.cities).not.toContain('c1');
    });

    it('addRelationship creates bidirectional edges', () => {
        const o1 = makeOfficer('o1');
        const o2 = makeOfficer('o2');
        store.addOfficer(o1);
        store.addOfficer(o2);
        store.addRelationship({ source: 'o1', target: 'o2', type: 'FRIEND', affinity: 80, history: [] });
        const rels1 = store.getRelationships('o1');
        const rels2 = store.getRelationships('o2');
        expect(rels1.length).toBe(1);
        expect(rels1[0].target).toBe('o2');
        expect(rels2.length).toBe(1);
        expect(rels2[0].target).toBe('o1');
    });

    it('removeOfficer cleans up indices', () => {
        const o = makeOfficer('o1');
        store.addOfficer(o);
        store.removeOfficer('o1');
        expect(store.getOfficer('o1')).toBeNull();
        expect(store.getOfficersByFaction('f1').length).toBe(0);
    });

    it('createSnapshot and restoreSnapshot deep copy integrity', () => {
        const o = makeOfficer('o1');
        store.addOfficer(o);
        const snap = store.createSnapshot();
        store.updateOfficer('o1', { loyalty: 50 });
        store.restoreSnapshot(snap);
        expect(store.getOfficer('o1')!.loyalty).toBe(80);
    });

    it('advanceTime increments turn/month/year', () => {
        store.advanceTime();
        const gs = store.getGlobalState();
        expect(gs.turnCount).toBe(1);
        expect(gs.time.month).toBe(2);
        expect(gs.time.year).toBe(192);
    });

    it('advanceTime wraps month at 12', () => {
        Object.assign(store, { globalState: { ...(store as any).globalState, time: { year: 192, month: 12 } } });
        store.advanceTime();
        const gs = store.getGlobalState();
        expect(gs.time.month).toBe(1);
        expect(gs.time.year).toBe(193);
    });

    it('initWorld batch initialization', () => {
        const o = makeOfficer('o1');
        const f = makeFaction('f1');
        const c = makeCity('c1');
        store.initWorld([o], [f], [c], []);
        expect(store.getOfficer('o1')).toBeDefined();
        expect(store.getFaction('f1')).toBeDefined();
        expect(store.getCity('c1')).toBeDefined();
    });

    it('subscribe/notify listener pattern', () => {
        const listener = vi.fn();
        const unsub = store.subscribe(listener);
        store.addOfficer(makeOfficer('o1'));
        expect(listener).toHaveBeenCalledTimes(1);
        unsub();
        store.addOfficer(makeOfficer('o2'));
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('getOfficersByFaction returns correct officers', () => {
        const o1 = makeOfficer('o1', { factionId: 'f1' });
        const o2 = makeOfficer('o2', { factionId: 'f1' });
        const o3 = makeOfficer('o3', { factionId: 'f2' });
        store.addOfficer(o1);
        store.addOfficer(o2);
        store.addOfficer(o3);
        const f1Officers = store.getOfficersByFaction('f1');
        expect(f1Officers.length).toBe(2);
        expect(f1Officers.map(o => o.id).sort()).toEqual(['o1', 'o2']);
    });

    it('getCitiesByFaction returns correct cities', () => {
        const f1 = makeFaction('f1', { cities: ['c1', 'c2'] });
        const c1 = makeCity('c1', { ownerId: 'f1' });
        const c2 = makeCity('c2', { ownerId: 'f1' });
        store.initWorld([], [f1], [c1, c2], []);
        const cities = store.getCitiesByFaction('f1');
        expect(cities.length).toBe(2);
    });

    it('setPhase updates phase', () => {
        store.setPhase(GamePhase.WORLD_MAP);
        expect(store.getGlobalState().phase).toBe(GamePhase.WORLD_MAP);
    });

    it('getAllOfficers/getAllFactions/getAllCities returns all', () => {
        store.addOfficer(makeOfficer('o1'));
        store.addOfficer(makeOfficer('o2'));
        expect(store.getAllOfficers().length).toBe(2);
    });
});

// ============================================================
// GameEngine 테스트
// ============================================================
describe('GameEngine', () => {
    let engine: GameEngine;
    let store: GameStore;

    beforeEach(() => {
        store = getInitializedStore();
        engine = new GameEngine(store);
    });

    it('constructor initializes FSM at TITLE phase', () => {
        expect(engine.getCurrentPhase()).toBe(GamePhase.TITLE);
    });

    it('transition() valid event changes phase', () => {
        const result = engine.transition('START');
        expect(result).toBe(true);
        expect(engine.getCurrentPhase()).toBe(GamePhase.WORLD_MAP);
    });

    it('transition() invalid event returns false', () => {
        const result = engine.transition('INVALID_EVENT');
        expect(result).toBe(false);
        expect(engine.getCurrentPhase()).toBe(GamePhase.TITLE);
    });

    it('getPhaseHistory records transitions', () => {
        engine.transition('START');
        const history = engine.getPhaseHistory();
        expect(history.length).toBe(1);
        expect(history[0].from).toBe(GamePhase.TITLE);
        expect(history[0].to).toBe(GamePhase.WORLD_MAP);
        expect(history[0].event).toBe('START');
    });

    it('enqueueCommand and executeAllCommands', () => {
        const o = makeOfficer('o1', { actionPoints: 100 });
        const c = makeCity('c1');
        store.initWorld([o], [], [c], []);
        const cmd = new DomesticCommand('o1', 'c1' as CityID, 'FARM', 0);
        engine.enqueueCommand(cmd);
        expect(engine.getPendingCommandCount()).toBe(1);
        const results = engine.executeAllCommands();
        expect(results.length).toBe(1);
        expect(results[0].success).toBe(true);
    });

    it('undoLastCommand and redoLastCommand', () => {
        const o = makeOfficer('o1', { actionPoints: 100 });
        const c = makeCity('c1');
        store.initWorld([o], [], [c], []);
        const cmd = new DomesticCommand('o1', 'c1' as CityID, 'FARM', 0);
        engine.enqueueCommand(cmd);
        engine.executeAllCommands();
        expect(engine.canUndo()).toBe(true);
        const undone = engine.undoLastCommand();
        expect(undone).toBe(true);
        expect(engine.canRedo()).toBe(true);
    });

    it('subscribe/emitEvent event system — 큐잉 후 processEventQueue에서 단일 발화', () => {
        const listener = vi.fn();
        engine.subscribe('TEST_EVENT', listener);
        engine.emitEvent({ id: 'e1', type: 'TEST_EVENT', payload: {}, timestamp: Date.now(), turn: 0 });
        // emitEvent는 큐잉만 하고, processEventQueue에서 발화한다 (이중 dispatch 방지)
        expect(listener).not.toHaveBeenCalled();
        (engine as unknown as { processEventQueue(): void }).processEventQueue();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('subscribe returns unsubscribe function', () => {
        const listener = vi.fn();
        const unsub = engine.subscribe('TEST_EVENT', listener);
        unsub();
        engine.emitEvent({ id: 'e1', type: 'TEST_EVENT', payload: {}, timestamp: Date.now(), turn: 0 });
        expect(listener).not.toHaveBeenCalled();
    });

    // ─────────────────────────────────────────────────────────────
    // [회귀] 이벤트 리스너 예외가 턴 전체를 중단시키지 않는다
    //
    // 배경: 리스너는 UI(main.ts) 를 포함해 외부에서 등록된다. 여기서 던진
    // 예외가 processEventQueue 를 뚫고 executeTurn 을 중단시키면 그 달
    // 처리와 남은 이벤트 발화가 함께 사라진다. 실제로 FREE_OFFICER_VISIT
    // payload 결손으로 턴이 멈췄던 사례가 있다.
    // ─────────────────────────────────────────────────────────────
    it('[회귀] 리스너 하나가 던져도 같은 이벤트의 나머지 리스너가 발화된다', () => {
        const boom = vi.fn(() => { throw new TypeError('리스너 내부 오류'); });
        const after = vi.fn();
        engine.subscribe('TEST_EVENT', boom);
        engine.subscribe('TEST_EVENT', after);

        engine.emitEvent({ id: 'e1', type: 'TEST_EVENT', payload: {}, timestamp: Date.now(), turn: 0 });
        expect(() => (engine as unknown as { processEventQueue(): void }).processEventQueue()).not.toThrow();

        expect(boom).toHaveBeenCalledTimes(1);
        expect(after).toHaveBeenCalledTimes(1);
    });

    it('[회귀] 리스너 예외가 나도 큐에 남은 이벤트는 계속 발화된다', () => {
        const boom = vi.fn(() => { throw new Error('첫 이벤트 처리 실패'); });
        const later = vi.fn();
        engine.subscribe('TEST_EVENT', boom);
        engine.subscribe('LATER_EVENT', later);

        engine.emitEvent({ id: 'e1', type: 'TEST_EVENT', payload: {}, timestamp: Date.now(), turn: 0 });
        engine.emitEvent({ id: 'e2', type: 'LATER_EVENT', payload: {}, timestamp: Date.now(), turn: 0 });
        (engine as unknown as { processEventQueue(): void }).processEventQueue();

        expect(later).toHaveBeenCalledTimes(1);
        expect(engine.getPendingEvents()).toHaveLength(0);
    });

    it('[회귀] 예외를 낸 리스너는 구독이 유지된다 (한 번의 실패로 소멸하지 않는다)', () => {
        let calls = 0;
        engine.subscribe('TEST_EVENT', () => { calls++; if (calls === 1) throw new Error('첫 발화만 실패'); });

        for (let i = 0; i < 2; i++) {
            engine.emitEvent({ id: `e${i}`, type: 'TEST_EVENT', payload: {}, timestamp: Date.now(), turn: 0 });
            (engine as unknown as { processEventQueue(): void }).processEventQueue();
        }
        expect(calls).toBe(2);
    });

    it('save/load serialization roundtrip', () => {
        const o = makeOfficer('o1');
        store.addOfficer(o);
        const saved = engine.save();
        store.updateOfficer('o1', { loyalty: 30 });
        engine.load(saved);
        expect(store.getOfficer('o1')!.loyalty).toBe(80);
    });

    it('연대기가 세이브에 포함되고 로드 시 복원된다 [Y-메타][441-460]', () => {
        engine.chronicle.clear();
        engine.chronicle.add('DESTROYED', '원소 세력이 멸망했다', { year: 200, month: 10, turn: 25 });
        engine.chronicle.add('PACT', '관우·장비 의형제 결의', { year: 184, month: 2, turn: 1 });
        const saved = engine.save();
        expect(saved.chronicle).toHaveLength(2);
        // 새 엔진에 로드 → 연대기 복원
        const store2 = new GameStore();
        const engine2 = new GameEngine(store2);
        expect(engine2.chronicle.size).toBe(0);
        engine2.load(saved);
        expect(engine2.chronicle.size).toBe(2);
        const list = engine2.chronicle.list();
        expect(list[0].text).toBe('관우·장비 의형제 결의'); // 최신순
        expect(list[1].text).toBe('원소 세력이 멸망했다');
    });

    it('구버전 세이브(연대기 없음) 로드 시 빈 상태로 정상 동작', () => {
        const saved = engine.save();
        const legacy = { ...saved, chronicle: undefined };
        const store2 = new GameStore();
        const engine2 = new GameEngine(store2);
        engine2.load(legacy);
        expect(engine2.chronicle.size).toBe(0);
    });

    it('initWorld starts at WORLD_MAP', () => {
        const o = makeOfficer('o1');
        const f = makeFaction('f1');
        const c = makeCity('c1');
        engine.initWorld([o], [f], [c], []);
        expect(engine.getCurrentPhase()).toBe(GamePhase.WORLD_MAP);
    });

    it('getPendingEvents returns queued events', () => {
        engine.emitEvent({ id: 'e1', type: 'TEST', payload: {}, timestamp: 1, turn: 0 });
        expect(engine.getPendingEvents().length).toBe(1);
    });

    it('terminateWorker cleans up', () => {
        engine.terminateWorker();
        expect(true).toBe(true);
    });
});

// ============================================================
// TurnScheduler 테스트
// ============================================================
describe('TurnScheduler', () => {
    it('start processes all tasks and calls onComplete', async () => {
        const processed: string[] = [];
        const scheduler = new TurnScheduler(async (task) => {
            processed.push(task.id);
        }, { chunkSize: 10, useIdleCallback: false });

        const tasks: ChunkTask[] = Array.from({ length: 5 }, (_, i) => ({
            id: `task_${i}`,
            officerId: `o${i}`,
            execute: () => {},
        }));

        scheduler.setTasks(tasks);
        const completePromise = new Promise<void>((resolve) => {
            scheduler.setOnComplete(() => resolve());
        });
        scheduler.start();
        await completePromise;
        expect(processed.length).toBe(5);
    });

    it('getProgress returns correct progress', () => {
        const scheduler = new TurnScheduler(async () => {}, { chunkSize: 50, useIdleCallback: false });
        const tasks: ChunkTask[] = Array.from({ length: 10 }, (_, i) => ({
            id: `t${i}`, officerId: `o${i}`, execute: () => {},
        }));
        scheduler.setTasks(tasks);
        const progress = scheduler.getProgress();
        expect(progress.total).toBe(10);
        expect(progress.completed).toBe(0);
        expect(progress.isComplete).toBe(false);
    });

    it('stop cancels running scheduler', () => {
        const scheduler = new TurnScheduler(async () => {}, { chunkSize: 50, useIdleCallback: false });
        const tasks: ChunkTask[] = Array.from({ length: 100 }, (_, i) => ({
            id: `t${i}`, officerId: `o${i}`, execute: () => {},
        }));
        scheduler.setTasks(tasks);
        scheduler.start();
        scheduler.stop();
        expect(scheduler.isCurrentlyRunning()).toBe(false);
    });
});

// ============================================================
// AITurnProcessor 테스트
// ============================================================
describe('AITurnProcessor', () => {
    it('processSingleOfficer skips FREE status', async () => {
        const store = getInitializedStore();
        const freeOfficer = makeOfficer('o_free', { status: 'FREE' as any, factionId: null, cityId: null });
        store.addOfficer(freeOfficer);
        const processor = new AITurnProcessor(store, 50);
        await processor.processSingleOfficer('o_free');
        expect(processor.getDecisions().length).toBe(0);
    });

    it('processSingleOfficer generates decision for active officer', async () => {
        const store = getInitializedStore();
        const f = makeFaction('f1');
        const c = makeCity('c1', { ownerId: 'f1' });
        const o = makeOfficer('o1', { factionId: 'f1', cityId: 'c1', status: 'OFFICER' as any });
        store.initWorld([o], [f], [c], []);
        const processor = new AITurnProcessor(store, 50);
        await processor.processSingleOfficer('o1');
        const decisions = processor.getDecisions();
        expect(decisions.length).toBe(1);
        expect(decisions[0].officerId).toBe('o1');
        expect(decisions[0].actionType).toBeDefined();
    });
});

// ============================================================
// TurnLifecycleManager 테스트
// ============================================================
describe('TurnLifecycleManager', () => {
    it('executeAITurn returns decisions for active officers', async () => {
        const store = getInitializedStore();
        const f = makeFaction('f1');
        const c = makeCity('c1', { ownerId: 'f1' });
        const o = makeOfficer('o1', { factionId: 'f1', cityId: 'c1', status: 'OFFICER' as any });
        store.initWorld([o], [f], [c], []);
        const manager = new TurnLifecycleManager(store);
        const decisions = await manager.executeAITurn();
        expect(decisions).toHaveLength(1);
        expect(decisions[0].officerId).toBe('o1');
        expect(store.getOfficer('o1')?.hasActedThisTurn).toBe(true);
    });
});
