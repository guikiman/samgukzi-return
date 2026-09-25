/**
 * [300] 이벤트 체인 큐 관리자 및 조건 검사기 (Event Chain Queue Manager & Condition Evaluator)
 *
 * Python 원본: src/systems/event_engine.py → TypeScript 포팅
 *
 * 설계 스펙:
 * - [300] Event 체인 큐(Queue) 관리자: O(1) 중복 방지, 연쇄 이벤트 활성화
 * - 수백 개의 연의전 조건(연도, 무장 생존, 소속 세력, 위치, 우호도)을 병목 없이 스캔
 * - 관계망 기반 AFFINITY 조건은 GameStore를 통해 평가 (graph_db 연동)
 * - [106-114] 시나리오 분기 관리자(scenario_branch_manager)와 연동
 */
export declare enum ConditionType {
    YEAR = "year",
    WARLORD_ALIVE = "warlord_alive",
    WARLORD_DEAD = "warlord_dead",
    FACTION = "faction",
    CITY_OWNER = "city_owner",
    AFFINITY = "affinity",
    LOCATION = "location",
    TURN_COUNT = "turn_count",
    RANDOM = "random",
    AND = "and",
    OR = "or"
}
export interface EventCondition {
    type: ConditionType;
    targetId?: string;
    targetFaction?: string;
    targetCity?: string;
    minValue?: number;
    maxValue?: number;
    probability?: number;
}
export interface EventResult {
    eventId: string;
    eventName: string;
    eventType: string;
    dialogueLines: string[];
    rewards: Record<string, unknown>;
    nextEventId: string | null;
}
export interface EventChainNode {
    eventId: string;
    eventName: string;
    conditions: EventCondition[];
    result: EventResult;
    chainNextId: string | null;
    priority: number;
}
/** 노드 생성 편의 팩토리 — 모든 필드 기본값 보장 */
export declare function createEventChainNode(eventId: string, eventName: string, conditions: EventCondition[], result?: Partial<EventResult>, chainNextId?: string | null, priority?: number): EventChainNode;
export interface WarlordSnapshot {
    status?: 'alive' | 'dead';
    factionId?: string | null;
    cityId?: string | null;
}
/** 조건 평가에 필요한 외부 상태 (GameStore에서 매 턴 스냅샷 구성) */
export interface EvaluationContext {
    currentYear: number;
    currentTurn: number;
    /** 무장 ID → 생존/소속/위치 스냅샷 */
    warlords: ReadonlyMap<string, WarlordSnapshot>;
    /** 무장 ID 간 우호도 조회 (graph_db / GameStore 연동, 없으면 0) */
    getAffinity?: (officerId: string) => number;
    /** 무장 ID → 현재 도시 ID (LOCATION 조건용) */
    getOfficerCity?: (officerId: string) => string | null;
    /** 세력 ID → 군주 ID (데이터의 leader_id 표기 조건 지원) */
    factionLeaders?: ReadonlyMap<string, string>;
    /** [0..1) 난수 공급자 (테스트 주입 가능) */
    rng?: () => number;
}
export declare class WarlordConditionEvaluator {
    evaluateCondition(cond: EventCondition, ctx: EvaluationContext): boolean;
    evaluateMulti(conditions: EventCondition[], ctx: EvaluationContext, logic?: 'and' | 'or'): boolean;
    /** 노드 조건 전체 평가 — 단일 조건은 즉시, 복수 조건은 AND */
    evaluate(node: EventChainNode, ctx: EvaluationContext): boolean;
}
export declare class EventChainQueueManager {
    private queue;
    private processed;
    private queuedIds;
    private chainMap;
    get queueSize(): number;
    /**
     * 중복 이벤트는 큐에 재진입하지 않음 (O(1) Set 조회).
     * processed는 활성화 시점에만 마킹하므로, 조건 미충족 노드는
     * scanAndActivate의 재적재에서 유실되지 않는다.
     */
    enqueue(node: EventChainNode): void;
    enqueueChain(chainId: string, nodes: EventChainNode[]): void;
    dequeue(): EventChainNode | null;
    /** 우선순위가 가장 높은(priority 최대) 노드를 꺼냄 */
    dequeueByPriority(): EventChainNode | null;
    isProcessed(eventId: string): boolean;
    /** 현재 큐에서 대기 중인 이벤트인지 (중복 적재 방지용) */
    isQueued(eventId: string): boolean;
    markProcessed(eventId: string): void;
    getChain(chainId: string): EventChainNode[];
    /** 현재 이벤트의 체인상 다음 노드 조회 (연쇄 이벤트) */
    getNextInChain(currentEventId: string): EventChainNode | null;
    /** 처리 완료된 이벤트를 큐에서 제거 */
    clearProcessed(): void;
    reset(): void;
}
export declare class EventEngine {
    readonly queueMgr: EventChainQueueManager;
    readonly evaluator: WarlordConditionEvaluator;
    private activeEvents;
    constructor(queueMgr: EventChainQueueManager, evaluator: WarlordConditionEvaluator);
    /** 큐 전체를 스캔하여 조건 충족 노드를 활성화, 미충족 노드는 재적재 [300] */
    scanAndActivate(ctx: EvaluationContext): EventChainNode[];
    getActiveEvents(): EventChainNode[];
    getNextChainEvent(currentEventId: string): EventChainNode | null;
    reset(): void;
}
//# sourceMappingURL=event_chain_engine.d.ts.map