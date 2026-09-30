/**
 * 삼국지리턴 — 연의전 이벤트 트리거 감지 및 비동기 시나리오 컴파일러
 * 파일: src/core/story_event_compiler.ts
 *
 * 선언적 JSON 스키마 → 런타임 조건 평가 → 체인 퀘스트 관리 → 트랜잭션 상태 적용
 *
 * [221~240] 연의전 조건부 내러티브 시스템
 * 관찰자(Observer) 패턴 기반 O(1) 사전 필터링
 * 다중 체인 퀘스트 스택 (Multi-Turn Chain Quest Stack)
 * 이벤트 실행 시 일반 루프를 비동기 정지(Pause) 가능
 */

import type {
    OfficerID, FactionID, CityID,
    Officer, Faction, GameTime, GameEvent, IGameStore,
} from './types.js';

// ============================================================
// 브랜디드 타입
// ============================================================

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type EventId = Brand<string, "EventId">;
export type ChainId = Brand<string, "ChainId">;
export function EventId(value: string): EventId { return value as EventId; }
export function ChainId(value: string): ChainId { return value as ChainId; }

// ============================================================
// 이벤트 스키마 — 선언적 JSON 대상
// ============================================================

export type ConditionOp = "EQ" | "NE" | "GT" | "GTE" | "LT" | "LTE" | "BETWEEN" | "ANY" | "NONE";

export type ConditionField =
    | "year" | "month" | "turn_count"
    | "officer_alive" | "officer_dead" | "officer_faction" | "officer_city"
    | "officer_hp" | "officer_loyalty" | "officer_fame" | "officer_merit"
    | "faction_exists" | "faction_reputation" | "faction_city_count" | "faction_officer_count"
    | "city_owner" | "city_defense" | "city_loyalty" | "city_population"
    | "event_triggered" | "chain_step_completed"
    | "random_probability"
    | "relation_type" | "affinity_between"
    | "set_global_flag";

export interface EventCondition {
    readonly field: ConditionField;
    readonly op: ConditionOp;
    readonly targetId?: string;
    readonly targetId2?: string;
    readonly value?: number;
    readonly value2?: number;
    readonly probability?: number;
}

export type TriggerLogic = "AND" | "OR";

export interface EventTrigger {
    readonly logic: TriggerLogic;
    readonly conditions: readonly EventCondition[];
}

export type ChainType = "single" | "multi_turn" | "branching";

export interface ChainConfig {
    readonly type: ChainType;
    readonly chainId?: ChainId;
    readonly stepIndex?: number;
    readonly totalSteps?: number;
    readonly expiryTurns?: number;
    readonly nextEventId?: EventId;
    readonly branchOnChoice?: boolean;
}

export type EffectType =
    | "modify_officer_stat" | "modify_officer_field"
    | "modify_faction_field"
    | "modify_city_field"
    | "add_relationship" | "remove_relationship"
    | "officer_death" | "officer_remove"
    | "faction_destroy" | "faction_transfer_officer" | "faction_transfer_city"
    | "emit_game_event"
    | "set_global_flag";

export interface StateEffect {
    readonly type: EffectType;
    readonly targetId: string;
    readonly targetId2?: string;
    readonly field?: string;
    readonly value?: number | string | boolean;
    readonly delta?: number;
}

export interface DialogueChoice {
    readonly label: string;
    readonly tooltip?: string;
    readonly effects: readonly StateEffect[];
    readonly nextEventId?: EventId;
    readonly branchToChainId?: ChainId;
}

export interface DialogueBlock {
    readonly lines: readonly string[];
    readonly speakerId?: OfficerID;
    readonly choices?: readonly DialogueChoice[];
    readonly autoAdvance?: boolean;
    readonly autoAdvanceDelayMs?: number;
}

export interface GameEventSchema {
    readonly id: EventId;
    readonly name: string;
    readonly description: string;
    readonly category: "historical" | "fictional" | "character" | "disaster" | "chain_step";
    readonly priority: number;
    readonly trigger: EventTrigger;
    readonly chain: ChainConfig;
    readonly dialogue: DialogueBlock;
    readonly effects: readonly StateEffect[];
    readonly onFailEffects?: readonly StateEffect[];
    /** 한 번만 실행 (false = 매 조건 충족 시 반복) */
    readonly once?: boolean;
}

// ============================================================
// 런타임 체인 퀘스트 상태
// ============================================================

export interface ActiveChainQuest {
    readonly chainId: ChainId;
    readonly name: string;
    readonly startedTurn: number;
    readonly startedTime: GameTime;
    readonly expiryTurns: number;
    readonly totalSteps: number;
    readonly completedSteps: readonly number[];
    readonly currentStep: number;
    readonly isExpired: boolean;
    readonly history: readonly {
        readonly step: number;
        readonly eventId: EventId;
        readonly completedTurn: number;
    }[];
}

// ============================================================
// 트리거 인덱스 — O(1) 사전 필터링 키
// ============================================================

type IndexKey = string;

function buildIndexKey(event: GameEventSchema): readonly IndexKey[] {
    const keys: IndexKey[] = [];
    for (const cond of event.trigger.conditions) {
        switch (cond.field) {
            case "year":
                if (cond.value !== undefined) keys.push(`year:${cond.value}`);
                break;
            case "month":
                if (cond.value !== undefined) keys.push(`month:${cond.value}`);
                break;
            case "officer_alive":
            case "officer_dead":
                if (cond.targetId) keys.push(`officer:${cond.targetId}`);
                break;
            case "officer_faction":
                if (cond.targetId) keys.push(`officer_faction:${cond.targetId}`);
                break;
            case "faction_exists":
                if (cond.targetId) keys.push(`faction:${cond.targetId}`);
                break;
            case "city_owner":
                if (cond.targetId) keys.push(`city:${cond.targetId}`);
                break;
            case "event_triggered":
                if (cond.targetId) keys.push(`event_dep:${cond.targetId}`);
                break;
            case "chain_step_completed":
                if (cond.targetId) keys.push(`chain:${cond.targetId}`);
                break;
            default:
                keys.push("global");
        }
    }
    if (keys.length === 0) keys.push("global");
    return keys;
}

// ============================================================
// 전용 에러 타입
// ============================================================

export class EventCompilerError extends Error {
    override readonly name = "EventCompilerError";
    constructor(
        public readonly eventId: EventId,
        message: string,
    ) {
        super(message);
    }
}

// ============================================================
// 조건 평가자
// ============================================================

export class ConditionEvaluator {
    constructor(
        private readonly store: IGameStore,
        private readonly completedEvents: ReadonlySet<string>,
        private readonly chainQuests: readonly ActiveChainQuest[],
        private readonly globalFlags: ReadonlyMap<string, boolean>,
    ) {}

    evaluate(conditions: readonly EventCondition[], logic: TriggerLogic, gameTime: GameTime, turnCount: number): boolean {
        const results = conditions.map(c => this.evaluateSingle(c, gameTime, turnCount));
        return logic === "AND" ? results.every(Boolean) : results.some(Boolean);
    }

    private evaluateSingle(cond: EventCondition, gameTime: GameTime, turnCount: number): boolean {
        const { field, op, targetId, targetId2, value, value2, probability } = cond;

        const actual = this.resolveField(field, targetId, targetId2, gameTime, turnCount);
        if (actual === undefined) return false;

        return this.compare(op, actual, value, value2, probability ?? 0.5);
    }

    private resolveField(
        field: ConditionField,
        targetId?: string,
        targetId2?: string,
        gameTime?: GameTime,
        turnCount?: number,
    ): unknown {
        switch (field) {
            case "year": return gameTime?.year;
            case "month": return gameTime?.month;
            case "turn_count": return turnCount;

            case "officer_alive": {
                if (!targetId) return false;
                const o = this.store.getOfficer(targetId as OfficerID);
                return o !== null;
            }
            case "officer_dead": {
                if (!targetId) return false;
                return this.store.getOfficer(targetId as OfficerID) === null;
            }
            case "officer_faction": {
                if (!targetId) return undefined;
                const o = this.store.getOfficer(targetId as OfficerID);
                if (!o) return undefined;
                return o.factionId;
            }
            case "officer_city": {
                if (!targetId) return undefined;
                const o = this.store.getOfficer(targetId as OfficerID);
                if (!o) return undefined;
                return o.cityId;
            }
            case "officer_hp": {
                if (!targetId) return undefined;
                const o = this.store.getOfficer(targetId as OfficerID);
                return o?.hp;
            }
            case "officer_loyalty": {
                if (!targetId) return undefined;
                const o = this.store.getOfficer(targetId as OfficerID);
                return o?.loyalty;
            }
            case "officer_fame": {
                if (!targetId) return undefined;
                const o = this.store.getOfficer(targetId as OfficerID);
                return o?.fame;
            }
            case "officer_merit": {
                if (!targetId) return undefined;
                const o = this.store.getOfficer(targetId as OfficerID);
                return o?.merit;
            }
            case "faction_exists": {
                if (!targetId) return false;
                return this.store.getFaction(targetId as FactionID) !== null;
            }
            case "faction_reputation": {
                if (!targetId) return undefined;
                const f = this.store.getFaction(targetId as FactionID);
                return f?.reputation;
            }
            case "faction_city_count": {
                if (!targetId) return undefined;
                const f = this.store.getFaction(targetId as FactionID);
                if (!f) return undefined;
                return f.cities.length;
            }
            case "faction_officer_count": {
                if (!targetId) return undefined;
                const f = this.store.getFaction(targetId as FactionID);
                if (!f) return undefined;
                return f.officers.length;
            }
            case "city_owner": {
                if (!targetId) return undefined;
                const c = this.store.getCity(targetId as CityID);
                return c?.ownerId;
            }
            case "city_defense": {
                if (!targetId) return undefined;
                const c = this.store.getCity(targetId as CityID);
                return c?.defense;
            }
            case "city_loyalty": {
                if (!targetId) return undefined;
                const c = this.store.getCity(targetId as CityID);
                return c?.loyalty;
            }
            case "city_population": {
                if (!targetId) return undefined;
                const c = this.store.getCity(targetId as CityID);
                return c?.population;
            }
            case "event_triggered": {
                return targetId ? this.completedEvents.has(targetId) : false;
            }
            case "chain_step_completed": {
                if (!targetId) return false;
                return this.chainQuests.some(q =>
                    (q.chainId as string) === targetId && q.completedSteps.length > 0,
                );
            }
            case "random_probability": {
                return Math.random();
            }
            case "relation_type":
            case "affinity_between": {
                if (!targetId || !targetId2) return undefined;
                const rels = this.store.getRelationships(targetId as OfficerID);
                const edge = rels.find(r => r.target === targetId2);
                if (!edge) return undefined;
                return field === "relation_type" ? edge.type : edge.affinity;
            }
            case "set_global_flag": {
                if (!targetId) return false;
                return this.globalFlags.get(targetId) ?? false;
            }
            default:
                return undefined;
        }
    }

    private compare(op: ConditionOp, actual: unknown, expected?: number, expected2?: number, prob?: number): boolean {
        switch (op) {
            case "EQ":
                if (typeof actual === "string" && typeof expected === "number") return actual === String(expected);
                if (typeof actual === "number" && typeof expected === "number") return actual === expected;
                return actual === expected;

            case "NE":
                if (typeof actual === "string" && typeof expected === "number") return actual !== String(expected);
                if (typeof actual === "number" && typeof expected === "number") return actual !== expected;
                return actual !== expected;

            case "GT":
                return typeof actual === "number" && expected !== undefined && actual > expected;
            case "GTE":
                return typeof actual === "number" && expected !== undefined && actual >= expected;
            case "LT":
                return typeof actual === "number" && expected !== undefined && actual < expected;
            case "LTE":
                return typeof actual === "number" && expected !== undefined && actual <= expected;
            case "BETWEEN":
                return typeof actual === "number" && expected !== undefined && expected2 !== undefined
                    && actual >= expected && actual <= expected2;
            case "ANY":
                return actual === undefined || actual !== null;
            case "NONE":
                return actual === undefined || actual === null;
            default:
                return false;
        }
    }
}

// ============================================================
// 트랜잭션 — 이벤트 효과를 안전하게 적용
// ============================================================

export interface Transaction {
    readonly eventId: EventId;
    readonly effects: readonly AppliedEffect[];
    readonly timestamp: number;
    readonly turn: number;
    readonly canRollback: boolean;
}

interface AppliedEffect {
    readonly effect: StateEffect;
    readonly oldValue: unknown;
    readonly success: boolean;
}

export class EventTransactionManager {
    private history: Transaction[] = [];
    private readonly store: IGameStore;

    constructor(store: IGameStore) {
        this.store = store;
    }

    applyEffects(eventId: EventId, effects: readonly StateEffect[], turn: number): Transaction {
        const applied: AppliedEffect[] = [];

        for (const effect of effects) {
            const oldValue = this.applySingleEffect(effect);
            applied.push({ effect, oldValue, success: true });
        }

        const tx: Transaction = {
            eventId,
            effects: applied,
            timestamp: Date.now(),
            turn,
            canRollback: true,
        };
        this.history.push(tx);
        return tx;
    }

    rollbackLast(): boolean {
        const tx = this.history.pop();
        if (!tx || !tx.canRollback) return false;
        for (const app of tx.effects) {
            this.rollbackSingle(app);
        }
        return true;
    }

    getHistory(): readonly Transaction[] {
        return [...this.history];
    }

    private applySingleEffect(effect: StateEffect): unknown {
        const { type, targetId, targetId2, field, value, delta } = effect;

        switch (type) {
            case "modify_officer_field": {
                const officer = this.store.getOfficer(targetId as OfficerID);
                if (!officer) return null;
                const old = (officer as unknown as Record<string, unknown>)[field ?? ""];
                if (delta !== undefined) {
                    const numOld = typeof old === "number" ? old : 0;
                    this.store.updateOfficer(targetId as OfficerID, { [field ?? ""]: numOld + delta } as Partial<import('./types.js').Officer>);
                } else if (value !== undefined) {
                    this.store.updateOfficer(targetId as OfficerID, { [field ?? ""]: value } as Partial<import('./types.js').Officer>);
                }
                return old;
            }

            case "modify_officer_stat": {
                const officer = this.store.getOfficer(targetId as OfficerID);
                if (!officer) return null;
                const statField = field as keyof import('./types.js').OfficerStats;
                const oldStats = { ...officer.stats };
                const deltaVal = delta ?? 0;
                this.store.updateOfficer(targetId as OfficerID, {
                    stats: {
                        ...officer.stats,
                        [statField]: Math.max(1, Math.min(100, officer.stats[statField] + deltaVal)),
                    },
                } as Partial<import('./types.js').Officer>);
                return oldStats;
            }

            case "modify_faction_field": {
                const faction = this.store.getFaction(targetId as FactionID);
                if (!faction) return null;
                const old = (faction as unknown as Record<string, unknown>)[field ?? ""];
                if (delta !== undefined) {
                    const numOld = typeof old === "number" ? old : 0;
                    this.store.updateFaction(targetId as FactionID, { [field ?? ""]: numOld + delta } as Partial<import('./types.js').Faction>);
                } else if (value !== undefined) {
                    this.store.updateFaction(targetId as FactionID, { [field ?? ""]: value } as Partial<import('./types.js').Faction>);
                }
                return old;
            }

            case "modify_city_field": {
                const city = this.store.getCity(targetId as CityID);
                if (!city) return null;
                const old = (city as unknown as Record<string, unknown>)[field ?? ""];
                if (delta !== undefined) {
                    const numOld = typeof old === "number" ? old : 0;
                    this.store.updateCity(targetId as CityID, { [field ?? ""]: numOld + delta } as Partial<import('./types.js').City>);
                } else if (value !== undefined) {
                    this.store.updateCity(targetId as CityID, { [field ?? ""]: value } as Partial<import('./types.js').City>);
                }
                return old;
            }

            case "officer_death":
            case "officer_remove": {
                const off = this.store.getOfficer(targetId as OfficerID);
                if (!off) return null;
                this.store.removeOfficer(targetId as OfficerID);
                return off;
            }

            case "faction_destroy": {
                const fac = this.store.getFaction(targetId as FactionID);
                if (!fac) return null;
                const cities = [...fac.cities];
                const officers = [...fac.officers];
                // 도시/무장 해방
                for (const cityId of cities) {
                    this.store.updateCity(cityId as CityID, { ownerId: null } as Partial<import('./types.js').City>);
                }
                for (const officerId of officers) {
                    this.store.updateOfficer(officerId as OfficerID, {
                        factionId: null,
                        status: "FREE" as import('./types.js').OfficerStatus,
                    } as Partial<import('./types.js').Officer>);
                }
                return fac;
            }

            case "faction_transfer_officer": {
                if (!targetId2) return null;
                const off = this.store.getOfficer(targetId as OfficerID);
                if (!off) return null;
                const oldFaction = off.factionId;
                this.store.updateOfficer(targetId as OfficerID, {
                    factionId: targetId2 as FactionID,
                } as Partial<import('./types.js').Officer>);
                return oldFaction;
            }

            case "faction_transfer_city": {
                if (!targetId2) return null;
                const city = this.store.getCity(targetId as CityID);
                if (!city) return null;
                const oldOwner = city.ownerId;
                this.store.updateCity(targetId as CityID, { ownerId: targetId2 as FactionID } as Partial<import('./types.js').City>);
                return oldOwner;
            }

            case "add_relationship": {
                const existing = this.store.getRelationships(targetId as OfficerID);
                const oldLen = existing.length;
                if (targetId2 && value) {
                    this.store.addRelationship({
                        source: targetId as OfficerID,
                        target: targetId2 as OfficerID,
                        type: String(value) as import('./types.js').RelationType,
                        affinity: delta ?? 50,
                        history: [{ year: 0, month: 0, event: "story_event", delta: delta ?? 50 }],
                    });
                }
                return oldLen;
            }

            case "set_global_flag": {
                this.store.setGlobalState({ [field!]: !!value } as Partial<import('./types.js').GlobalState>);
                return null;
            }

            case "emit_game_event": {
                this.store.setGlobalState({ phase: "EVENT" as import('./types.js').GamePhase } as Partial<import('./types.js').GlobalState>);
                return null;
            }

            default:
                return null;
        }
    }

    private rollbackSingle(applied: AppliedEffect): void {
        if (!applied.success) return;
        this.applySingleEffect({
            type: applied.effect.type,
            targetId: applied.effect.targetId,
            targetId2: applied.effect.targetId2,
            field: applied.effect.field,
            value: (applied.oldValue as Record<string, unknown>)?.id
                ? undefined
                : (applied.oldValue as number | string | boolean | undefined),
            delta: applied.effect.delta !== undefined
                ? -applied.effect.delta
                : undefined,
        });
    }
}

// ============================================================
// 메인 컴파일러
// ============================================================

export class StoryEventCompiler {
    private readonly events = new Map<EventId, GameEventSchema>();
    private readonly index = new Map<IndexKey, readonly EventId[]>();
    private readonly completedEvents = new Set<string>();
    private readonly chainQuests = new Map<ChainId, ActiveChainQuest>();
    private readonly globalFlags = new Map<string, boolean>();
    private readonly onceEvents = new Set<EventId>();
    private readonly evaluator: ConditionEvaluator;
    private readonly txManager: EventTransactionManager;
    private readonly store: IGameStore;
    private paused = false;
    private onPauseRequest: (() => void) | null = null;

    constructor(store: IGameStore) {
        this.store = store;
        this.evaluator = new ConditionEvaluator(
            store,
            this.completedEvents,
            [...this.chainQuests.values()],
            this.globalFlags,
        );
        this.txManager = new EventTransactionManager(store);
    }

    // ============================================================
    // 이벤트 등록
    // ============================================================

    registerEvent(schema: GameEventSchema): void {
        if (this.events.has(schema.id)) {
            throw new EventCompilerError(schema.id, `Duplicate event: ${schema.id}`);
        }
        this.events.set(schema.id, schema);
        if (schema.once) {
            this.onceEvents.add(schema.id);
        }

        const keys = buildIndexKey(schema);
        for (const key of keys) {
            const existing = this.index.get(key) ?? [];
            this.index.set(key, [...existing, schema.id]);
        }
    }

    registerEvents(schemas: readonly GameEventSchema[]): void {
        for (const schema of schemas) {
            this.registerEvent(schema);
        }
    }

    // ============================================================
    // 트리거 평가 — O(1) 인덱스 조회
    // ============================================================

    scanActivatableEvents(gameTime: GameTime, turnCount: number): readonly GameEventSchema[] {
        const candidates = new Set<EventId>();
        const gs = this.store.getGlobalState();

        // O(1) 인덱스 키 생성
        const keys: IndexKey[] = [
            `year:${gameTime.year}`,
            `month:${gameTime.month}`,
        ];

        // 세력 키
        for (const faction of this.store.getAllFactions()) {
            keys.push(`faction:${faction.id}`);
        }

        // 무장 키
        const officers = this.store.getAllOfficers();
        for (const officer of officers) {
            keys.push(`officer:${officer.id}`);
            if (officer.factionId) keys.push(`officer_faction:${officer.factionId}`);
            if (officer.cityId) keys.push(`city:${officer.cityId}`);
        }

        keys.push("global");

        // 인덱스에서 후보 수집
        for (const key of keys) {
            const matched = this.index.get(key);
            if (matched) {
                for (const eventId of matched) {
                    candidates.add(eventId);
                }
            }
        }

        // 완료된 once 이벤트 제외
        const result: GameEventSchema[] = [];
        for (const eventId of candidates) {
            if (this.onceEvents.has(eventId) && this.completedEvents.has(eventId as string)) continue;
            const schema = this.events.get(eventId);
            if (!schema) continue;

            // 조건 평가
            const triggered = this.evaluator.evaluate(
                schema.trigger.conditions,
                schema.trigger.logic,
                gameTime,
                turnCount,
            );
            if (triggered) {
                result.push(schema);
            }
        }

        // 우선순위 정렬
        result.sort((a, b) => b.priority - a.priority);
        return result;
    }

    // ============================================================
    // 이벤트 실행 — 트랜잭션 + 체인 진행
    // ============================================================

    executeEvent(schema: GameEventSchema, turnCount: number): Transaction {
        // 1. 체인 진행 상태 검증
        if (schema.chain.type === "multi_turn" || schema.chain.type === "branching") {
            const chainId = schema.chain.chainId;
            if (!chainId) throw new EventCompilerError(schema.id, "multi_turn events require chainId");
            if (chainId && schema.chain.stepIndex !== undefined && schema.chain.stepIndex > 0) {
                const active = this.chainQuests.get(chainId);
                if (!active) {
                    throw new EventCompilerError(schema.id, `Chain ${chainId} not active for step ${schema.chain.stepIndex}`);
                }
                if (active.currentStep !== schema.chain.stepIndex) {
                    throw new EventCompilerError(schema.id, `Chain step mismatch: expected ${active.currentStep}, got ${schema.chain.stepIndex}`);
                }
            }
        }

        // 2. 효과 적용 (트랜잭션)
        const tx = this.txManager.applyEffects(schema.id, schema.effects, turnCount);

        // 3. 완료 처리
        this.completedEvents.add(schema.id as string);

        // 4. 체인 진행
        if (schema.chain.type === "multi_turn" && schema.chain.chainId) {
            this.advanceChain(schema.chain.chainId, schema.id, schema.chain.stepIndex ?? 0, turnCount);
        }

        // 5. 분기 체인 처리
        if (schema.chain.type === "branching" && schema.chain.chainId) {
            this.startChain(schema.chain.chainId, schema, turnCount, schema.chain.expiryTurns ?? 12);
        }

        return tx;
    }

    // ============================================================
    // 체인 퀘스트 스택
    // ============================================================

    startChain(chainId: ChainId, rootEvent: GameEventSchema, turnCount: number, expiryTurns: number): ActiveChainQuest {
        if (this.chainQuests.has(chainId)) {
            throw new EventCompilerError(rootEvent.id, `Chain ${chainId} already active`);
        }
        const gs = this.store.getGlobalState();
        const quest: ActiveChainQuest = {
            chainId,
            name: rootEvent.name,
            startedTurn: turnCount,
            startedTime: { ...gs.time },
            expiryTurns,
            totalSteps: rootEvent.chain.totalSteps ?? 1,
            completedSteps: [],
            currentStep: 0,
            isExpired: false,
            history: [],
        };
        this.chainQuests.set(chainId, quest);
        return quest;
    }

    advanceChain(chainId: ChainId, eventId: EventId, step: number, turnCount: number): ActiveChainQuest | null {
        const quest = this.chainQuests.get(chainId);
        if (!quest) return null;

        const updated: ActiveChainQuest = {
            ...quest,
            completedSteps: [...quest.completedSteps, step],
            currentStep: step + 1,
            history: [...quest.history, { step, eventId, completedTurn: turnCount }],
        };

        if (updated.currentStep >= updated.totalSteps) {
            // 체인 완료
            this.chainQuests.delete(chainId);
        } else {
            this.chainQuests.set(chainId, updated);
        }

        return updated;
    }

    /** 만료된 체인 퀘스트 정리 (매 턴 호출) */
    cleanupExpiredChains(turnCount: number): readonly ChainId[] {
        const expired: ChainId[] = [];
        for (const [chainId, quest] of this.chainQuests) {
            if (turnCount - quest.startedTurn >= quest.expiryTurns) {
                expired.push(chainId);
            }
        }
        for (const id of expired) {
            this.chainQuests.delete(id);
        }
        return expired;
    }

    getActiveChain(chainId: ChainId): ActiveChainQuest | undefined {
        return this.chainQuests.get(chainId);
    }

    getAllActiveChains(): readonly ActiveChainQuest[] {
        return [...this.chainQuests.values()];
    }

    // ============================================================
    // 게임 루프 정지/재개 (이벤트 실행 중)
    // ============================================================

    get isPaused(): boolean {
        return this.paused;
    }

    requestPause(): Promise<void> {
        this.paused = true;
        return new Promise(resolve => {
            this.onPauseRequest = resolve;
        });
    }

    resume(): void {
        if (this.onPauseRequest) {
            this.onPauseRequest();
            this.onPauseRequest = null;
        }
        this.paused = false;
    }

    // ============================================================
    // 전체 상태 관리
    // ============================================================

    isEventCompleted(eventId: EventId): boolean {
        return this.completedEvents.has(eventId as string);
    }

    getCompletedEvents(): ReadonlySet<string> {
        return this.completedEvents;
    }

    setGlobalFlag(key: string, value: boolean): void {
        this.globalFlags.set(key, value);
    }

    getGlobalFlag(key: string): boolean {
        return this.globalFlags.get(key) ?? false;
    }

    getRegisteredEventCount(): number {
        return this.events.size;
    }

    resetSimulation(): void {
        this.completedEvents.clear();
        this.chainQuests.clear();
        this.globalFlags.clear();
    }
}

// ============================================================
// 예제: 적벽대전 동남풍 기원 이벤트
// ============================================================

export const RED_CLIFFS_SCHEMAS: readonly GameEventSchema[] = [
    {
        id: EventId("red_cliffs_01_cao_advance"),
        name: "조조 남하",
        description: "조조가 83만 대군을 이끌고 강남으로 진군한다.",
        category: "historical",
        priority: 90,
        trigger: {
            logic: "AND",
            conditions: [
                { field: "year", op: "GTE", value: 208 },
                { field: "month", op: "GTE", value: 9 },
                { field: "officer_alive", op: "EQ", targetId: "caocao", value: 1 },
                { field: "officer_alive", op: "EQ", targetId: "sunquan", value: 1 },
                { field: "officer_alive", op: "EQ", targetId: "liubei", value: 1 },
                { field: "faction_exists", op: "EQ", targetId: "wei", value: 1 },
                { field: "faction_exists", op: "EQ", targetId: "wu", value: 1 },
                { field: "faction_exists", op: "EQ", targetId: "shu", value: 1 },
            ],
        },
        chain: {
            type: "multi_turn",
            chainId: ChainId("red_cliffs_chain"),
            stepIndex: 0,
            totalSteps: 4,
            expiryTurns: 24,
            nextEventId: EventId("red_cliffs_02_alliance"),
        },
        dialogue: {
            lines: [
                "조조: 고 하후돈! 장료! 83만 대군으로 강남을 짓밟아라!",
                "조조: 손권과 유비, 그 쥐새끼들을 한 방에 날려버리겠다!",
            ],
            speakerId: "caocao" as OfficerID,
        },
        effects: [
            {
                type: "modify_faction_field",
                targetId: "wei",
                field: "reputation",
                delta: 10,
            },
            {
                type: "emit_game_event",
                targetId: "red_cliffs_01_cao_advance",
            },
        ],
        once: true,
    },
    {
        id: EventId("red_cliffs_02_alliance"),
        name: "손유 연합 결성",
        description: "제갈량이 동오로 가 손권과 유비의 동맹을 성사시킨다.",
        category: "historical",
        priority: 85,
        trigger: {
            logic: "AND",
            conditions: [
                { field: "event_triggered", op: "EQ", targetId: "red_cliffs_01_cao_advance", value: 1 },
                { field: "chain_step_completed", op: "EQ", targetId: "red_cliffs_chain", value: 0 },
                { field: "officer_alive", op: "EQ", targetId: "zhugeliang", value: 1 },
                { field: "officer_alive", op: "EQ", targetId: "zhouyu", value: 1 },
            ],
        },
        chain: {
            type: "multi_turn",
            chainId: ChainId("red_cliffs_chain"),
            stepIndex: 1,
            totalSteps: 4,
            expiryTurns: 24,
            nextEventId: EventId("red_cliffs_03_southeast_wind"),
        },
        dialogue: {
            lines: [
                "제갈량: 공근(주유)을 만나러 가자. 조조의 대군을 막으려면 손오와 촉이 힘을 합쳐야 한다.",
                "주유: 공명! 제갈孔明! 자네의 지혜가 필요하네.",
                "제갈량: 조조의 83만 대군을 불로 태워버릴 계책이 있습니다.",
            ],
            speakerId: "zhugeliang" as OfficerID,
            autoAdvance: true,
            autoAdvanceDelayMs: 2000,
        },
        effects: [
            {
                type: "add_relationship",
                targetId: "liubei",
                targetId2: "sunquan",
                value: "ALLIANCE",
                delta: 30,
            },
            {
                type: "modify_faction_field",
                targetId: "shu",
                field: "reputation",
                delta: 15,
            },
        ],
        once: true,
    },
    {
        id: EventId("red_cliffs_03_southeast_wind"),
        name: "제갈량 동남풍 기원",
        description: "주유가 화공 계책을 내지만 동남풍이 불지 않는다. 제갈량이 제단을 쌓고 동남풍을 빌어온다.",
        category: "historical",
        priority: 80,
        trigger: {
            logic: "AND",
            conditions: [
                { field: "event_triggered", op: "EQ", targetId: "red_cliffs_02_alliance", value: 1 },
                { field: "chain_step_completed", op: "EQ", targetId: "red_cliffs_chain", value: 1 },
                { field: "month", op: "EQ", value: 11 },
                { field: "officer_alive", op: "EQ", targetId: "zhugeliang", value: 1 },
                { field: "officer_alive", op: "EQ", targetId: "zhouyu", value: 1 },
            ],
        },
        chain: {
            type: "multi_turn",
            chainId: ChainId("red_cliffs_chain"),
            stepIndex: 2,
            totalSteps: 4,
            expiryTurns: 24,
            nextEventId: EventId("red_cliffs_04_fire_attack"),
        },
        dialogue: {
            lines: [
                "주유: 겨울인데 어찌 동남풍이 불겠는가!",
                "제갈량: 제가 칠성단을 쌓고 동남풍을 빌어오겠소.",
                "... 칠성단 위에서 제갈량이 도를 외우자 갑자기 동남풍이 거세게 분다!",
                "주유: 제갈孔明! 신과 같은 자로다!",
                "제갈량: 이제 출화(火攻)를 개시하라!",
            ],
            speakerId: "zhugeliang" as OfficerID,
            autoAdvance: true,
            autoAdvanceDelayMs: 3000,
        },
        effects: [
            {
                type: "set_global_flag",
                targetId: "flag_southeast_wind",
                field: "weather",
                value: "STORM",
            },
            {
                type: "modify_officer_field",
                targetId: "zhugeliang",
                field: "fame",
                delta: 30,
            },
        ],
        once: true,
    },
    {
        id: EventId("red_cliffs_04_fire_attack"),
        name: "적벽대전 — 화공",
        description: "황개의 배에 불을 붙여 조조의 수군 진영으로 돌진시킨다. 동남풍을 타고 불길이 조조의 대군을 집어삼킨다.",
        category: "historical",
        priority: 75,
        trigger: {
            logic: "AND",
            conditions: [
                { field: "event_triggered", op: "EQ", targetId: "red_cliffs_03_southeast_wind", value: 1 },
                { field: "chain_step_completed", op: "EQ", targetId: "red_cliffs_chain", value: 2 },
                { field: "officer_alive", op: "EQ", targetId: "huanggai", value: 1 },
                { field: "officer_alive", op: "EQ", targetId: "caocao", value: 1 },
            ],
        },
        chain: {
            type: "multi_turn",
            chainId: ChainId("red_cliffs_chain"),
            stepIndex: 3,
            totalSteps: 4,
            expiryTurns: 24,
        },
        dialogue: {
            lines: [
                "황개: 불을 질러라! 조조의 대선단을 불태워라!",
                "⇒ 화공선 20척이 조조의 수군 진영으로 돌진한다!",
                "동남풍을 타고 불길이 하늘을 뒤덮는다!",
                "조조: 속았다! 이 몸을 버리지 않으면... 도주하라!",
            ],
            speakerId: "huanggai" as OfficerID,
            choices: [
                {
                    label: "조조를 추격한다 — 사실 경로",
                    tooltip: "화공 후 조조를 추격, 도중에 조조가 도망가는 이벤트 발생",
                    effects: [
                        {
                            type: "modify_faction_field",
                            targetId: "wu",
                            field: "reputation",
                            delta: 40,
                        },
                        {
                            type: "modify_faction_field",
                            targetId: "wei",
                            field: "reputation",
                            delta: -30,
                        },
                    ],
                    nextEventId: EventId("red_cliffs_05_pursuit"),
                },
                {
                    label: "회군한다 — 가상 IF 경로",
                    tooltip: "화공 승리 후 바로 회군, 조조가 위로 귀환 (역사 변경)",
                    effects: [
                        {
                            type: "modify_faction_field",
                            targetId: "wu",
                            field: "reputation",
                            delta: 25,
                        },
                        {
                            type: "modify_officer_field",
                            targetId: "zhouyu",
                            field: "fame",
                            delta: 20,
                        },
                    ],
                    branchToChainId: ChainId("if_red_cliffs_early_return"),
                },
            ],
        },
        effects: [
            {
                type: "modify_faction_field",
                targetId: "wu",
                field: "reputation",
                delta: 50,
            },
            {
                type: "modify_faction_field",
                targetId: "wei",
                field: "gold",
                delta: -20000,
            },
            {
                type: "set_global_flag",
                targetId: "flag_red_cliffs_complete",
                field: "red_cliffs_complete",
                value: true,
            },
        ],
        once: true,
    },
] as const;
