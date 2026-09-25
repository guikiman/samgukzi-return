/**
 * 삼국지 8 리메이크 — AI 스트리밍 매니저 (메인 스레드 사이드)
 * 파일: src/ai/ai_stream_manager.ts
 *
 * Web Worker를 스폰하고 AI 턴을 위임하며, 세력 단위 연산 결과를
 * 실시간 스트리밍으로 수신해 UI/관계망에 즉시 반영한다.
 *
 * [201] Web Worker 비동기 AI 연산
 * [202] 메인 스레드 블로킹 방지
 *
 * 스냅샷 압축: 대용량 전체 상태를 넘기지 않고 AI 연산에 필요한
 * 최소 데이터셋(Officer/City/Faction Snapshot)만 직렬화하여 전달.
 */
import type { AITurnPayload, FactionDecisionBatch } from './ai_worker_simulator.js';
export type { AITurnPayload, OfficerSnapshot, CitySnapshot, FactionSnapshot, FactionDecisionBatch, } from './ai_worker_simulator.js';
/** 스트리밍 수신 콜백 */
export interface AIStreamCallbacks {
    /** 세력별 연산 완료 시 콜백 — UI 및 관계망 DB 즉시 업데이트 */
    onFactionUpdate: (batch: FactionDecisionBatch) => void;
    /** 전체 1,000명 연산 완료 시 콜백 */
    onTurnComplete?: (summary: {
        totalDecisions: number;
        elapsedMs: number;
    }) => void;
    /** 워커 오류 콜백 */
    onError?: (message: string) => void;
}
/** GameEngine 도메인 → Worker 스냅샷 변환 입력 (최소 인터페이스) */
export interface SnapshotSource {
    getGlobalState(): {
        year: number;
        month: number;
        turnCount: number;
    };
    getAllOfficers(): Array<{
        id: string;
        name: string;
        factionId: string | null;
        cityId: string | null;
        ambition: number;
        loyalty: number;
        morality: number;
        infamy: number;
        stats: {
            leadership: number;
            might: number;
            intelligence: number;
            politics: number;
            charisma: number;
        };
    }>;
    getAllFactions(): Array<{
        id: string;
        name: string;
        leaderId: string;
        gold: number;
        food: number;
        cities: string[];
        officers: string[];
        policy: {
            militaryFocus: number;
            economyFocus: number;
            diplomacyFocus: number;
            recruitmentFocus: number;
            cultureFocus: number;
        };
        diplomacy: Record<string, {
            treaty: string;
        }>;
    }>;
    getAllCities(): Array<{
        id: string;
        name: string;
        ownerId: string | null;
        defense: number;
        population: number;
        funds: number;
        goldIncome: number;
        foodIncome: number;
        development: number;
    }>;
}
export declare class AIStreamManager {
    private worker;
    private callbacks;
    private isTurnRunning;
    private pendingResolve;
    constructor(callbacks: AIStreamCallbacks);
    /** 워커를 지연 스폰한다 (첫 AI 턴 호출 시점에 생성) */
    private ensureWorker;
    private handleMessage;
    /**
     * 게임 상태에서 AI 연산에 필요한 최소 데이터셋만 추출한다.
     * 도시 병량은 월 식량 수입 × 10으로 추정하고, 주둔 병력은 방어도로 프록시한다.
     */
    static buildSnapshot(source: SnapshotSource, playerFactionId: string | null): AITurnPayload;
    /** 매달 평정 페이즈 시작 시 호출 — AI 턴을 워커에 위임 */
    startMonthlyTurn(payload: AITurnPayload): Promise<void>;
    /** AI 턴 진행 여부 */
    isBusy(): boolean;
    /** 워커를 종료하고 대기 중인 턴을 안전하게 해제한다. */
    terminate(): void;
}
//# sourceMappingURL=ai_stream_manager.d.ts.map