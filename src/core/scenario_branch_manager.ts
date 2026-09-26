/**
 * [106-114] 연의전 사실/가상 분기 관리자 — Scenario Branch Manager
 *
 * Python 원본: src/systems/scenario_branch_manager.py → TypeScript 포팅
 *
 * 설계 스펙:
 * - 사실(Historical) 및 가상(Fictional) 경로 관리
 * - 이벤트 체인 노드(EventChainNode) 그룹화 및 선택적 트리거
 * - event_chain_engine.ts [300]의 큐 관리자와 연동
 */

import {
    EventEngine,
    EventChainNode,
} from './event_chain_engine.js';

// ============================================================
// 1. 분기 타입 및 정의
// ============================================================

export enum BranchType {
    HISTORICAL = 'historical',
    FICTIONAL = 'fictional',
}

export interface ScenarioBranch {
    branchId: string;
    branchType: BranchType;
    /** 이 분기가 활성화되기 위한 조건 이벤트 ID */
    conditionId: string;
    nodes: EventChainNode[];
}

// ============================================================
// 2. 분기 관리자
// ============================================================

export class ScenarioBranchManager {
    private branches: Map<string, ScenarioBranch> = new Map();
    private activeBranchId: string | null = null;

    registerBranch(branch: ScenarioBranch): void {
        this.branches.set(branch.branchId, branch);
    }

    selectBranch(branchId: string): boolean {
        if (this.branches.has(branchId)) {
            this.activeBranchId = branchId;
            return true;
        }
        return false;
    }

    /** 분기를 선택하고 해당 체인 노드들을 이벤트 엔진 큐에 적재 [300] */
    activateBranch(branchId: string, eventEngine: EventEngine): boolean {
        if (!this.selectBranch(branchId)) return false;

        const branch = this.branches.get(branchId)!;
        eventEngine.queueMgr.enqueueChain(branchId, branch.nodes);
        return true;
    }

    getActiveBranchId(): string | null {
        return this.activeBranchId;
    }

    getBranch(branchId: string): ScenarioBranch | undefined {
        return this.branches.get(branchId);
    }

    /** 조건 이벤트(conditionId)가 발생했는지 여부로 활성 가능 분기 조회 */
    getAvailableBranches(firedEventIds: ReadonlySet<string>): ScenarioBranch[] {
        const available: ScenarioBranch[] = [];
        for (const branch of this.branches.values()) {
            if (firedEventIds.has(branch.conditionId)) {
                available.push(branch);
            }
        }
        return available;
    }

    reset(): void {
        this.branches.clear();
        this.activeBranchId = null;
    }
}

// ============================================================
// 3. 특수 이벤트 즉시 트리거
// ============================================================

export type SpecialEventType =
    | 'EMPEROR_ACCESSION'   // 황제 즉위
    | 'PLAGUE'              // 질병
    | 'DISASTER'            // 재해
    | 'REBELLION'           // 반란
    | 'OMEN';               // 천변

export class SpecialEventTrigger {
    constructor(private readonly eventEngine: EventEngine) {}

    /** 황제 즉위, 질병, 재해 등 즉시 활성화 트리거 (중복 적재 방지) */
    triggerSpecialEvent(eventType: SpecialEventType, targetId: string): boolean {
        const eventId = `special_${eventType}_${targetId}`;
        if (this.eventEngine.queueMgr.isProcessed(eventId)) return false;
        if (this.eventEngine.queueMgr.isQueued(eventId)) return false;

        const node: EventChainNode = {
            eventId,
            eventName: `특수 이벤트 — ${eventType}`,
            conditions: [], // 특수 이벤트는 조건 없이 즉시 활성
            result: {
                eventId,
                eventName: `특수 이벤트 — ${eventType}`,
                eventType: 'SPECIAL',
                dialogueLines: [],
                nextEventId: null,
            },
            chainNextId: null,
            priority: 100, // 특수 이벤트는 최우선 처리
        };
        this.eventEngine.queueMgr.enqueue(node);
        return true;
    }
}
