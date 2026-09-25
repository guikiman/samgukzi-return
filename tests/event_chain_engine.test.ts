import { describe, it, expect } from 'vitest';
import {
    ConditionType,
    WarlordConditionEvaluator,
    EventChainQueueManager,
    EventEngine,
    createEventChainNode,
    type EventChainNode,
    type EvaluationContext,
} from '../src/core/event_chain_engine.js';
import {
    BranchType,
    ScenarioBranchManager,
    SpecialEventTrigger,
} from '../src/core/scenario_branch_manager.js';

// ============================================================
// 테스트 헬퍼
// ============================================================

function makeCtx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
    return {
        currentYear: 200,
        currentTurn: 5,
        warlords: new Map([
            ['cao_cao', { status: 'alive', factionId: 'wei', cityId: 'xuchang' }],
            ['liu_bei', { status: 'alive', factionId: 'shu', cityId: 'xinye' }],
            ['dong_zhuo', { status: 'dead', factionId: null, cityId: null }],
        ]),
        getAffinity: () => 0,
        getOfficerCity: (id) => {
            const w = new Map([
                ['cao_cao', 'xuchang'],
                ['liu_bei', 'xinye'],
            ]).get(id);
            return w ?? null;
        },
        rng: () => 0.9, // RANDOM 조건: probability 0.5 미만이면 false
        ...overrides,
    };
}

function makeNode(
    eventId: string,
    conditions: EventChainNode['conditions'],
    priority = 0,
): EventChainNode {
    return createEventChainNode(eventId, `이벤트 ${eventId}`, conditions, {}, null, priority);
}

// ============================================================
// 조건 평가기 [300]
// ============================================================

describe('WarlordConditionEvaluator [300]', () => {
    const evaluator = new WarlordConditionEvaluator();

    it('YEAR 조건 — min/max 범위 평가', () => {
        const ctx = makeCtx({ currentYear: 200 });
        expect(evaluator.evaluateCondition({ type: ConditionType.YEAR, minValue: 190, maxValue: 210 }, ctx)).toBe(true);
        expect(evaluator.evaluateCondition({ type: ConditionType.YEAR, minValue: 210 }, ctx)).toBe(false);
        expect(evaluator.evaluateCondition({ type: ConditionType.YEAR, maxValue: 190 }, ctx)).toBe(false);
    });

    it('TURN_COUNT 조건', () => {
        const ctx = makeCtx({ currentTurn: 5 });
        expect(evaluator.evaluateCondition({ type: ConditionType.TURN_COUNT, minValue: 1 }, ctx)).toBe(true);
        expect(evaluator.evaluateCondition({ type: ConditionType.TURN_COUNT, maxValue: 3 }, ctx)).toBe(false);
    });

    it('WARLORD_ALIVE / WARLORD_DEAD 조건', () => {
        const ctx = makeCtx();
        expect(evaluator.evaluateCondition({ type: ConditionType.WARLORD_ALIVE, targetId: 'cao_cao' }, ctx)).toBe(true);
        expect(evaluator.evaluateCondition({ type: ConditionType.WARLORD_ALIVE, targetId: 'dong_zhuo' }, ctx)).toBe(false);
        expect(evaluator.evaluateCondition({ type: ConditionType.WARLORD_DEAD, targetId: 'dong_zhuo' }, ctx)).toBe(true);
        // 미등록 무장은 DEAD로 간주
        expect(evaluator.evaluateCondition({ type: ConditionType.WARLORD_DEAD, targetId: 'unknown' }, ctx)).toBe(true);
    });

    it('FACTION / CITY_OWNER 조건', () => {
        const ctx = makeCtx();
        expect(evaluator.evaluateCondition({ type: ConditionType.FACTION, targetId: 'cao_cao', targetFaction: 'wei' }, ctx)).toBe(true);
        expect(evaluator.evaluateCondition({ type: ConditionType.FACTION, targetId: 'cao_cao', targetFaction: 'shu' }, ctx)).toBe(false);
        expect(evaluator.evaluateCondition({ type: ConditionType.CITY_OWNER, targetId: 'liu_bei', targetCity: 'xinye' }, ctx)).toBe(true);
        expect(evaluator.evaluateCondition({ type: ConditionType.CITY_OWNER, targetId: 'liu_bei', targetCity: 'xuchang' }, ctx)).toBe(false);
    });

    it('FACTION 조건 — targetId 생략 시 세력 존재 여부를 검사한다', () => {
        const ctx = makeCtx({
            warlords: new Map([
                ['cao_cao', { factionId: 'wei', cityId: 'xuchang' }],
            ]),
        });
        expect(evaluator.evaluateCondition({ type: ConditionType.FACTION, targetFaction: 'wei' }, ctx)).toBe(true);
        expect(evaluator.evaluateCondition({ type: ConditionType.FACTION, targetFaction: 'dong_zhuo' }, ctx)).toBe(false);
    });

    it('AFFINITY 조건 — getAffinity 콜백 연동 (관계망 [C-인간관계])', () => {
        const ctx = makeCtx({ getAffinity: (id) => (id === 'guan_yu' ? 80 : 0) });
        expect(evaluator.evaluateCondition({ type: ConditionType.AFFINITY, targetId: 'guan_yu', minValue: 50 }, ctx)).toBe(true);
        expect(evaluator.evaluateCondition({ type: ConditionType.AFFINITY, targetId: 'unknown', minValue: 50 }, ctx)).toBe(false);
        expect(evaluator.evaluateCondition({ type: ConditionType.AFFINITY, targetId: 'guan_yu', maxValue: 50 }, ctx)).toBe(false);
    });

    it('LOCATION 조건', () => {
        const ctx = makeCtx();
        expect(evaluator.evaluateCondition({ type: ConditionType.LOCATION, targetId: 'cao_cao', targetCity: 'xuchang' }, ctx)).toBe(true);
        expect(evaluator.evaluateCondition({ type: ConditionType.LOCATION, targetId: 'cao_cao', targetCity: 'hefei' }, ctx)).toBe(false);
    });

    it('RANDOM 조건 — rng 주입 및 확률 경계', () => {
        const ctxLow = makeCtx({ rng: () => 0.1 });
        const ctxHigh = makeCtx({ rng: () => 0.9 });
        const cond = { type: ConditionType.RANDOM, probability: 0.5 };
        expect(evaluator.evaluateCondition(cond, ctxLow)).toBe(true);
        expect(evaluator.evaluateCondition(cond, ctxHigh)).toBe(false);
    });

    it('복수 조건 AND 평가', () => {
        const ctx = makeCtx({ currentYear: 207 });
        const node = makeNode('t1', [
            { type: ConditionType.YEAR, minValue: 207 },
            { type: ConditionType.WARLORD_ALIVE, targetId: 'liu_bei' },
        ]);
        expect(evaluator.evaluate(node, ctx)).toBe(true);

        const nodeFail = makeNode('t2', [
            { type: ConditionType.YEAR, minValue: 207 },
            { type: ConditionType.WARLORD_ALIVE, targetId: 'dong_zhuo' },
        ]);
        expect(evaluator.evaluate(nodeFail, ctx)).toBe(false);
    });
});

// ============================================================
// 체인 큐 관리자 [300]
// ============================================================

describe('EventChainQueueManager [300]', () => {
    it('enqueue — 중복 이벤트는 재진입하지 않는다', () => {
        const mgr = new EventChainQueueManager();
        const node = makeNode('ev1', []);
        mgr.enqueue(node);
        mgr.enqueue(node);
        expect(mgr.queueSize).toBe(1);
    });

    it('dequeueByPriority — 우선순위 최대 노드부터 꺼낸다', () => {
        const mgr = new EventChainQueueManager();
        mgr.enqueue(makeNode('low', [], 1));
        mgr.enqueue(makeNode('high', [], 10));
        mgr.enqueue(makeNode('mid', [], 5));
        expect(mgr.dequeueByPriority()?.eventId).toBe('high');
        expect(mgr.dequeueByPriority()?.eventId).toBe('mid');
        expect(mgr.dequeueByPriority()?.eventId).toBe('low');
        expect(mgr.dequeueByPriority()).toBeNull();
    });

    it('체인 등록 및 다음 노드 조회 (연쇄 이벤트)', () => {
        const mgr = new EventChainQueueManager();
        const chain = [makeNode('c1', []), makeNode('c2', []), makeNode('c3', [])];
        mgr.enqueueChain('guandu_chain', chain);

        expect(mgr.getChain('guandu_chain')).toHaveLength(3);
        expect(mgr.getNextInChain('c1')?.eventId).toBe('c2');
        expect(mgr.getNextInChain('c2')?.eventId).toBe('c3');
        expect(mgr.getNextInChain('c3')).toBeNull();
        expect(mgr.getNextInChain('nonexistent')).toBeNull();
    });

    it('markProcessed 후 clearProcessed로 큐 정리', () => {
        const mgr = new EventChainQueueManager();
        mgr.enqueue(makeNode('done', []));
        mgr.enqueue(makeNode('pending', []));
        mgr.markProcessed('done');
        mgr.clearProcessed();
        expect(mgr.queueSize).toBe(1);
        expect(mgr.isProcessed('done')).toBe(true);
    });
});

// ============================================================
// 이벤트 엔진 — 스캔/활성화 [300]
// ============================================================

describe('EventEngine [300]', () => {
    it('scanAndActivate — 조건 충족 노드 활성화, 미충족은 큐에 유지', () => {
        const engine = new EventEngine(new EventChainQueueManager(), new WarlordConditionEvaluator());
        engine.queueMgr.enqueue(makeNode('fire_now', [{ type: ConditionType.YEAR, minValue: 184 }]));
        engine.queueMgr.enqueue(makeNode('fire_later', [{ type: ConditionType.YEAR, minValue: 220 }]));

        const activated = engine.scanAndActivate(makeCtx({ currentYear: 200 }));
        expect(activated.map(n => n.eventId)).toEqual(['fire_now']);
        expect(engine.queueMgr.queueSize).toBe(1); // fire_later만 남음
        expect(engine.getActiveEvents()).toHaveLength(1);
    });

    it('활성화된 이벤트는 markProcessed되어 재활성화되지 않는다', () => {
        const engine = new EventEngine(new EventChainQueueManager(), new WarlordConditionEvaluator());
        engine.queueMgr.enqueue(makeNode('once', []));

        const first = engine.scanAndActivate(makeCtx());
        expect(first).toHaveLength(1);
        // 재적재 후에도 processed라 큐에 안 들어감
        engine.queueMgr.enqueue(makeNode('once', []));
        expect(engine.queueMgr.queueSize).toBe(0);
    });

    it('체인 연쇄 — 첫 이벤트 발동 후에만 다음 이벤트를 적재한다', () => {
        const engine = new EventEngine(new EventChainQueueManager(), new WarlordConditionEvaluator());
        engine.queueMgr.enqueueChain('chain', [makeNode('a', []), makeNode('b', [])]);

        const firstBatch = engine.scanAndActivate(makeCtx());
        expect(firstBatch.map(n => n.eventId)).toEqual(['a']);
        expect(engine.queueMgr.queueSize).toBe(0);

        const next = engine.getNextChainEvent('a');
        expect(next?.eventId).toBe('b');
        engine.queueMgr.enqueue(next!);
        expect(engine.scanAndActivate(makeCtx()).map(n => n.eventId)).toEqual(['b']);
    });
});

// ============================================================
// 시나리오 분기 [106-114]
// ============================================================

describe('ScenarioBranchManager [106-114]', () => {
    it('분기 등록/선택/활성화', () => {
        const engine = new EventEngine(new EventChainQueueManager(), new WarlordConditionEvaluator());
        const mgr = new ScenarioBranchManager();
        mgr.registerBranch({
            branchId: 'hist_guandu',
            branchType: BranchType.HISTORICAL,
            conditionId: 'guandu_fired',
            nodes: [makeNode('h1', []), makeNode('h2', [])],
        });
        mgr.registerBranch({
            branchId: 'fic_guandu',
            branchType: BranchType.FICTIONAL,
            conditionId: 'guandu_fired',
            nodes: [makeNode('f1', [])],
        });

        expect(mgr.activateBranch('hist_guandu', engine)).toBe(true);
        expect(mgr.getActiveBranchId()).toBe('hist_guandu');
        expect(engine.queueMgr.queueSize).toBe(1);
        expect(mgr.activateBranch('unknown', engine)).toBe(false);
    });

    it('발생한 이벤트 기준 활성 가능 분기 필터링', () => {
        const mgr = new ScenarioBranchManager();
        mgr.registerBranch({
            branchId: 'a', branchType: BranchType.HISTORICAL, conditionId: 'evt_x', nodes: [],
        });
        mgr.registerBranch({
            branchId: 'b', branchType: BranchType.FICTIONAL, conditionId: 'evt_y', nodes: [],
        });
        const fired = new Set(['evt_x']);
        const avail = mgr.getAvailableBranches(fired);
        expect(avail.map(b => b.branchId)).toEqual(['a']);
    });
});

// ============================================================
// 특수 이벤트 트리거
// ============================================================

describe('SpecialEventTrigger', () => {
    it('특수 이벤트 즉시 적재 — 최우선순위, 중복 방지', () => {
        const engine = new EventEngine(new EventChainQueueManager(), new WarlordConditionEvaluator());
        const trigger = new SpecialEventTrigger(engine);

        expect(trigger.triggerSpecialEvent('EMPEROR_ACCESSION', 'cao_cao')).toBe(true);
        expect(trigger.triggerSpecialEvent('EMPEROR_ACCESSION', 'cao_cao')).toBe(false); // 중복

        expect(engine.queueMgr.queueSize).toBe(1);
        const top = engine.queueMgr.dequeueByPriority();
        expect(top?.priority).toBe(100);
        expect(top?.result.eventType).toBe('SPECIAL');
    });
});
