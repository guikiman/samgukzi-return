/**
 * 시나리오 연의전 이벤트 체인 로더 [300][106-114]
 *
 * src/data/scenarios/events/index.json의 체인 정의를 읽어
 * EventChainNode로 변환하고 EventEngine 큐에 적재한다.
 *
 * 설계 스펙:
 * - [300] 이벤트 체인 큐 관리자와 연동 — 시나리오 시작 시 전체 체인 적재
 * - JSON Schema 검증 [301] — 모더 확장 데이터가 게임을 파괴하지 않도록 방어
 * - 시나리오 ID로 필터링하여 해당 시나리오의 체인만 로드
 */

import { ConditionType, createEventChainNode } from './event_chain_engine.js';
import type { EventChainNode, EventCondition, EventResult } from './event_chain_engine.js';

// ============================================================
// JSON 데이터 구조 (컴파일 타임 타입)
// ============================================================

export interface EventChainJsonCondition {
    type: string;
    targetId?: string;
    targetFaction?: string;
    targetCity?: string;
    minValue?: number;
    maxValue?: number;
    probability?: number;
}

export interface EventChainJsonNode {
    eventId: string;
    eventName: string;
    priority?: number;
    conditions: EventChainJsonCondition[];
    result?: {
        eventType?: string;
        dialogueLines?: string[];
        nextEventId?: string | null;
    };
}

export interface EventChainJson {
    eventId: string;
    eventName: string;
    conditions: EventChainJsonCondition[];
    result?: Partial<EventResult>;
    chainNextId?: string | null;
    priority?: number;
}

export interface ScenarioEventChainJson {
    scenarioId: string;
    chainId: string;
    chainName?: string;
    nodes: EventChainJsonNode[];
}

export interface ScenarioEventsFile {
    chains: ScenarioEventChainJson[];
}

// ============================================================
// JSON Schema 기반 유효성 검사 [301] — 모더 데이터 방어
// ============================================================

const VALID_CONDITION_TYPES = new Set<string>(Object.values(ConditionType));

export class EventChainValidationError extends Error {
    constructor(message: string, readonly chainId: string) {
        super(`[${chainId}] ${message}`);
        this.name = 'EventChainValidationError';
    }
}

/** 단일 체인 JSON 검증 — 위반 시 EventChainValidationError */
function validateChain(chain: unknown, index: number): asserts chain is ScenarioEventChainJson {
    if (typeof chain !== 'object' || chain === null) {
        throw new EventChainValidationError(`체인 #${index}가 객체가 아님`, `#chain-${index}`);
    }
    const c = chain as Record<string, unknown>;
    if (typeof c.scenarioId !== 'string' || c.scenarioId.length === 0) {
        throw new EventChainValidationError('scenarioId 필수', `#chain-${index}`);
    }
    if (typeof c.chainId !== 'string' || c.chainId.length === 0) {
        throw new EventChainValidationError('chainId 필수', `#chain-${index}`);
    }
    const chainId = c.chainId as string;
    if (!Array.isArray(c.nodes)) {
        throw new EventChainValidationError('nodes 배열 필수', chainId);
    }
    for (const [i, node] of (c.nodes as unknown[]).entries()) {
        if (typeof node !== 'object' || node === null) {
            throw new EventChainValidationError(`노드 #${i}가 객체가 아님`, chainId);
        }
        const n = node as Record<string, unknown>;
        if (typeof n.eventId !== 'string' || n.eventId.length === 0) {
            throw new EventChainValidationError(`노드 #${i}의 eventId 필수`, chainId);
        }
        if (typeof n.eventName !== 'string') {
            throw new EventChainValidationError(`노드 ${n.eventId}의 eventName 필수`, chainId);
        }
        if (!Array.isArray(n.conditions)) {
            throw new EventChainValidationError(`노드 ${n.eventId}의 conditions 배열 필수`, chainId);
        }
        for (const [j, cond] of (n.conditions as unknown[]).entries()) {
            if (typeof cond !== 'object' || cond === null) {
                throw new EventChainValidationError(`노드 ${n.eventId} 조건 #${j}가 객체가 아님`, chainId);
            }
            const cd = cond as Record<string, unknown>;
            if (typeof cd.type !== 'string' || !VALID_CONDITION_TYPES.has(cd.type)) {
                throw new EventChainValidationError(
                    `노드 ${n.eventId} 조건 #${j}의 type 미지원: ${String(cd.type)}`,
                    chainId,
                );
            }
        }
    }
}

// ============================================================
// 변환 및 적재
// ============================================================

/** JSON 조건 → EventCondition */
function toCondition(raw: EventChainJsonCondition): EventCondition {
    return {
        type: raw.type as ConditionType,
        targetId: raw.targetId,
        targetFaction: raw.targetFaction,
        targetCity: raw.targetCity,
        minValue: raw.minValue,
        maxValue: raw.maxValue,
        probability: raw.probability,
    };
}

/** JSON 노드 → EventChainNode (createEventChainNode로 기본값 보장) */
export function toEventChainNode(raw: EventChainJsonNode): EventChainNode {
    return createEventChainNode(
        raw.eventId,
        raw.eventName,
        raw.conditions.map(toCondition),
        {
            eventType: raw.result?.eventType,
            dialogueLines: raw.result?.dialogueLines,
            nextEventId: raw.result?.nextEventId ?? null,
        },
        null, // 체인 연결은 노드 배열 순서(getNextInChain)로 결정
        raw.priority ?? 0,
    );
}

/** 시나리오 ID에 해당하는 체인 노드 맵 반환 — { chainId: EventChainNode[] } */
export function parseScenarioEvents(
    file: unknown,
    scenarioId: string,
): Map<string, EventChainNode[]> {
    const data = file as Partial<ScenarioEventsFile> | null;
    if (!data || !Array.isArray(data.chains)) {
        return new Map();
    }
    const result = new Map<string, EventChainNode[]>();
    for (const [i, chain] of data.chains.entries()) {
        validateChain(chain, i);
        if (chain.scenarioId !== scenarioId) continue;
        result.set(chain.chainId, chain.nodes.map(toEventChainNode));
    }
    return result;
}

/**
 * 시나리오 이벤트 체인을 EventEngine 큐에 적재 [300].
 * 시나리오 선택 시 1회 호출. 이미 적재된 체인은 건너뛴다.
 * @returns 적재된 체인 ID 목록
 */
export function loadScenarioEventChains(
    eventEngine: import('./event_chain_engine.js').EventEngine,
    file: unknown,
    scenarioId: string,
): string[] {
    const chains = parseScenarioEvents(file, scenarioId);
    const loaded: string[] = [];
    for (const [chainId, nodes] of chains) {
        eventEngine.queueMgr.enqueueChain(chainId, nodes);
        loaded.push(chainId);
    }
    return loaded;
}

// ============================================================
// 정적 JSON 임포트 — import attribute 필수 (Node/브라우저 ESM 규격)
// ============================================================

import scenarioEventsJson from '../data/scenarios/events/index.json' with { type: 'json' };

/** 빌트인 시나리오 이벤트 파일 (모더 데이터와 병합 가능) */
export const BUILTIN_SCENARIO_EVENTS: ScenarioEventsFile = scenarioEventsJson as ScenarioEventsFile;
