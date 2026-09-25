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

// ============================================================
// 1. 조건 타입 및 노드 정의
// ============================================================

export enum ConditionType {
    YEAR = 'year',
    WARLORD_ALIVE = 'warlord_alive',
    WARLORD_DEAD = 'warlord_dead',
    FACTION = 'faction',
    CITY_OWNER = 'city_owner',
    AFFINITY = 'affinity',
    LOCATION = 'location',
    TURN_COUNT = 'turn_count',
    RANDOM = 'random',
    AND = 'and',
    OR = 'or',
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
export function createEventChainNode(
    eventId: string,
    eventName: string,
    conditions: EventCondition[],
    result: Partial<EventResult> = {},
    chainNextId: string | null = null,
    priority = 0,
): EventChainNode {
    return {
        eventId,
        eventName,
        conditions,
        result: {
            eventId,
            eventName,
            eventType: result.eventType ?? 'SCENE',
            dialogueLines: result.dialogueLines ?? [],
            rewards: result.rewards ?? {},
            nextEventId: result.nextEventId ?? null,
        },
        chainNextId,
        priority,
    };
}

// ============================================================
// 2. 평가 컨텍스트 — 무장/세력/도시 스냅샷 주입
// ============================================================

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

// ============================================================
// 3. 조건 평가기 (WarlordConditionEvaluator 포팅)
// ============================================================

export class WarlordConditionEvaluator {
    evaluateCondition(cond: EventCondition, ctx: EvaluationContext): boolean {
        switch (cond.type) {
            case ConditionType.YEAR: {
                if (cond.minValue !== undefined && ctx.currentYear < cond.minValue) return false;
                if (cond.maxValue !== undefined && ctx.currentYear > cond.maxValue) return false;
                return true;
            }
            case ConditionType.TURN_COUNT: {
                if (cond.minValue !== undefined && ctx.currentTurn < cond.minValue) return false;
                if (cond.maxValue !== undefined && ctx.currentTurn > cond.maxValue) return false;
                return true;
            }
            case ConditionType.WARLORD_ALIVE: {
                const target = ctx.warlords.get(cond.targetId ?? '');
                return target !== undefined && (target.status ?? 'alive') === 'alive';
            }
            case ConditionType.WARLORD_DEAD: {
                const target = ctx.warlords.get(cond.targetId ?? '');
                return target === undefined || (target.status ?? 'alive') === 'dead';
            }
            case ConditionType.FACTION: {
                const matchesFaction = (factionId: string | null | undefined): boolean =>
                    factionId !== null && factionId !== undefined &&
                    (factionId === cond.targetFaction ||
                     ctx.factionLeaders?.get(factionId) === cond.targetFaction);
                if (cond.targetId) {
                    const target = ctx.warlords.get(cond.targetId);
                    return target !== undefined && matchesFaction(target.factionId);
                }
                // targetId가 생략된 세력 조건은 해당 세력의 세력이 하나라도
                // 존재하는지 확인한다 (예: 02 시나리오의 동탁 존재 조건).
                return [...ctx.warlords.values()].some(warlord => matchesFaction(warlord.factionId));
            }
            case ConditionType.CITY_OWNER: {
                const target = ctx.warlords.get(cond.targetId ?? '');
                if (!target) return false;
                return target.cityId === cond.targetCity;
            }
            case ConditionType.AFFINITY: {
                const affinity = ctx.getAffinity?.(cond.targetId ?? '') ?? 0;
                if (cond.minValue !== undefined && affinity < cond.minValue) return false;
                if (cond.maxValue !== undefined && affinity > cond.maxValue) return false;
                return true;
            }
            case ConditionType.LOCATION: {
                const cityId = ctx.getOfficerCity?.(cond.targetId ?? '') ?? null;
                return cityId !== null && cityId === cond.targetCity;
            }
            case ConditionType.RANDOM: {
                const rng = ctx.rng ?? Math.random;
                return rng() < (cond.probability ?? 0.5);
            }
            default:
                return false;
        }
    }

    evaluateMulti(conditions: EventCondition[], ctx: EvaluationContext, logic: 'and' | 'or' = 'and'): boolean {
        if (conditions.length === 0) return true;
        const results = conditions.map(c => this.evaluateCondition(c, ctx));
        return logic === 'or' ? results.some(Boolean) : results.every(Boolean);
    }

    /** 노드 조건 전체 평가 — 단일 조건은 즉시, 복수 조건은 AND */
    evaluate(node: EventChainNode, ctx: EvaluationContext): boolean {
        if (node.conditions.length === 0) return true;
        return node.conditions.every(c => this.evaluateCondition(c, ctx));
    }
}

// ============================================================
// 4. 이벤트 체인 큐 관리자 [300]
// ============================================================

export class EventChainQueueManager {
    private queue: EventChainNode[] = [];
    private processed: Set<string> = new Set();
    private queuedIds: Set<string> = new Set();
    private chainMap: Map<string, EventChainNode[]> = new Map();

    get queueSize(): number {
        return this.queue.length;
    }

    /**
     * 중복 이벤트는 큐에 재진입하지 않음 (O(1) Set 조회).
     * processed는 활성화 시점에만 마킹하므로, 조건 미충족 노드는
     * scanAndActivate의 재적재에서 유실되지 않는다.
     */
    enqueue(node: EventChainNode): void {
        if (this.processed.has(node.eventId) || this.queuedIds.has(node.eventId)) return;
        this.queuedIds.add(node.eventId);
        this.queue.push(node);
    }

    enqueueChain(chainId: string, nodes: EventChainNode[]): void {
        this.chainMap.set(chainId, nodes);
        // 이미 진행 중인 체인이면 중복 적재로 다음 노드를 선행 적재하지 않는다.
        if (nodes.some(node => this.queuedIds.has(node.eventId))) return;
        // 체인은 첫 노드의 조건이 충족된 뒤에만 다음 노드를 적재한다.
        // 모든 노드를 처음부터 큐에 넣으면 선행 조건을 무시하거나 같은 턴에
        // 연쇄 전체가 활성화되는 중복 발화 버그가 발생한다. [300]
        const firstPending = nodes.find(node =>
            !this.processed.has(node.eventId) && !this.queuedIds.has(node.eventId),
        );
        if (firstPending) this.enqueue(firstPending);
    }

    dequeue(): EventChainNode | null {
        const node = this.queue.shift() ?? null;
        if (node) this.queuedIds.delete(node.eventId);
        return node;
    }

    /** 우선순위가 가장 높은(priority 최대) 노드를 꺼냄 */
    dequeueByPriority(): EventChainNode | null {
        if (this.queue.length === 0) return null;
        let maxIdx = 0;
        for (let i = 1; i < this.queue.length; i++) {
            if (this.queue[i].priority > this.queue[maxIdx].priority) maxIdx = i;
        }
        const [node] = this.queue.splice(maxIdx, 1);
        this.queuedIds.delete(node.eventId);
        return node;
    }

    isProcessed(eventId: string): boolean {
        return this.processed.has(eventId);
    }

    /** 현재 큐에서 대기 중인 이벤트인지 (중복 적재 방지용) */
    isQueued(eventId: string): boolean {
        return this.queuedIds.has(eventId);
    }

    markProcessed(eventId: string): void {
        this.processed.add(eventId);
    }

    getChain(chainId: string): EventChainNode[] {
        return this.chainMap.get(chainId) ?? [];
    }

    /** 현재 이벤트의 체인상 다음 노드 조회 (연쇄 이벤트) */
    getNextInChain(currentEventId: string): EventChainNode | null {
        for (const chainNodes of this.chainMap.values()) {
            for (let i = 0; i < chainNodes.length; i++) {
                if (chainNodes[i].eventId === currentEventId && i + 1 < chainNodes.length) {
                    return chainNodes[i + 1];
                }
            }
        }
        return null;
    }

    /** 처리 완료된 이벤트를 큐에서 제거 */
    clearProcessed(): void {
        this.queue = this.queue.filter(n => !this.processed.has(n.eventId));
        this.queuedIds = new Set(this.queue.map(n => n.eventId));
    }

    reset(): void {
        this.queue = [];
        this.processed.clear();
        this.queuedIds.clear();
        this.chainMap.clear();
    }
}

// ============================================================
// 5. 이벤트 엔진 — 스캔/활성화 오케스트레이터 [300]
// ============================================================

export class EventEngine {
    private activeEvents: EventChainNode[] = [];

    constructor(
        public readonly queueMgr: EventChainQueueManager,
        public readonly evaluator: WarlordConditionEvaluator,
    ) {}

    /** 큐 전체를 스캔하여 조건 충족 노드를 활성화, 미충족 노드는 재적재 [300] */
    scanAndActivate(ctx: EvaluationContext): EventChainNode[] {
        const activated: EventChainNode[] = [];
        const remaining: EventChainNode[] = [];

        while (this.queueMgr.queueSize > 0) {
            const node = this.queueMgr.dequeue();
            if (node === null) break;
            if (this.evaluator.evaluate(node, ctx)) {
                activated.push(node);
                this.queueMgr.markProcessed(node.eventId);
            } else {
                remaining.push(node);
            }
        }

        for (const node of remaining) {
            this.queueMgr.enqueue(node);
        }

        this.activeEvents = activated;
        return activated;
    }

    getActiveEvents(): EventChainNode[] {
        return this.activeEvents;
    }

    getNextChainEvent(currentEventId: string): EventChainNode | null {
        return this.queueMgr.getNextInChain(currentEventId);
    }

    reset(): void {
        this.queueMgr.reset();
        this.activeEvents = [];
    }
}
