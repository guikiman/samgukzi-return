/**
 * 삼국지리턴 — AI 스트리밍 매니저 (메인 스레드 사이드)
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

import type {
    AITurnPayload,
    FactionDecisionBatch,
    WorkerOutboundMessage,
} from './ai_worker_simulator.js';
import { resolveAIMonthlyDifficulty, DEFAULT_DIFFICULTY } from '../core/difficulty_balance_system.js';

export type {
    AITurnPayload,
    OfficerSnapshot,
    CitySnapshot,
    FactionSnapshot,
    FactionDecisionBatch,
} from './ai_worker_simulator.js';

/** 스트리밍 수신 콜백 */
export interface AIStreamCallbacks {
    /** 세력별 연산 완료 시 콜백 — UI 및 관계망 DB 즉시 업데이트 */
    onFactionUpdate: (batch: FactionDecisionBatch) => void;
    /** 전체 1,000명 연산 완료 시 콜백 */
    onTurnComplete?: (summary: { totalDecisions: number; elapsedMs: number }) => void;
    /** 워커 오류 콜백 */
    onError?: (message: string) => void;
}

/** GameEngine 도메인 → Worker 스냅샷 변환 입력 (최소 인터페이스) */
export interface SnapshotSource {
    getGlobalState(): { time: { year: number; month: number }; turnCount: number; difficulty?: number };
    getAllOfficers(): Array<{
        id: string; name: string; factionId: string | null; cityId: string | null;
        ambition: number; loyalty: number; morality: number; infamy: number;
        stats: { leadership: number; might: number; intelligence: number; politics: number; charisma: number };
    }>;
    getAllFactions(): Array<{
        id: string; name: string; leaderId: string; gold: number; food: number;
        cities: string[]; officers: string[];
        policy: { militaryFocus: number; economyFocus: number; diplomacyFocus: number; recruitmentFocus: number; cultureFocus: number };
        diplomacy: Record<string, { treaty: string }>;
    }>;
    getAllCities(): Array<{
        id: string; name: string; ownerId: string | null; defense: number;
        population: number; funds: number; goldIncome: number; foodIncome: number;
        development: number;
    }>;
}

export class AIStreamManager {
    private worker: Worker | null = null;
    private callbacks: AIStreamCallbacks;
    private isTurnRunning = false;
    private pendingResolve: (() => void) | null = null;

    constructor(callbacks: AIStreamCallbacks) {
        this.callbacks = callbacks;
    }

    // ============================================================
    // 워커 라이프사이클
    // ============================================================

    /** 워커를 지연 스폰한다 (첫 AI 턴 호출 시점에 생성) */
    private ensureWorker(): Worker {
        if (this.worker) return this.worker;
        // TS 빌드 산출물(dist) 기준 URL 스폰 — game_engine.ts와 동일 패턴
        this.worker = new Worker(new URL('./ai_stream_worker.js', import.meta.url), { type: 'module' });
        this.worker.onmessage = (event: MessageEvent) => this.handleMessage(event.data as WorkerOutboundMessage);
        this.worker.onerror = (event: ErrorEvent) => {
            // 스크립트 로드 실패 등 치명 오류 — 대기 중인 턴 프로미스를 해제해 교착 방지
            this.isTurnRunning = false;
            this.pendingResolve?.();
            this.pendingResolve = null;
            this.callbacks.onError?.(event.message ?? 'AI worker unknown error');
        };
        return this.worker;
    }

    private handleMessage(message: WorkerOutboundMessage): void {
        switch (message.type) {
            case 'STREAM_FACTION_DECISION':
                // 실시간 스트리밍 데이터 수신: UI 및 관계망 DB 즉시 업데이트
                this.callbacks.onFactionUpdate(message.data);
                break;
            case 'AI_TURN_COMPLETE':
                this.isTurnRunning = false;
                this.pendingResolve?.();
                this.pendingResolve = null;
                this.callbacks.onTurnComplete?.(message.data);
                break;
            case 'ERROR':
                this.isTurnRunning = false;
                this.pendingResolve?.();
                this.pendingResolve = null;
                this.callbacks.onError?.(message.data);
                break;
        }
    }

    // ============================================================
    // 스냅샷 변환 — 최소 데이터셋 직렬화
    // ============================================================

    /**
     * 게임 상태에서 AI 연산에 필요한 최소 데이터셋만 추출한다.
     * 도시 병량은 월 식량 수입 × 10으로 추정하고, 주둔 병력은 방어도로 프록시한다.
     */
    static buildSnapshot(source: SnapshotSource, playerFactionId: string | null): AITurnPayload {
        const gs = source.getGlobalState();

        const cities: AITurnPayload['cities'] = {};
        for (const c of source.getAllCities()) {
            cities[c.id] = {
                id: c.id,
                name: c.name,
                ownerId: c.ownerId,
                defense: Math.max(0, Math.min(100, c.defense)),
                population: c.population,
                funds: c.funds,
                foodStores: c.foodIncome * 10,
                // [결함 수정] development 은 병력 수다. Math.min(100, …) 로
                // 잘라내면 병력이 수천~수만인 도시가 워커에 100 으로 전달돼
                // 스트리밍 AI 가 모든 도시를 "병력 100" 으로 판단했다.
                // 단, 워커 쪽 chooseDomesticAction 이 이 값을 0~100 개발도와
                // 나란히 비교하므로 병력 그대로 두면 그쪽 비교가 무의미해진다.
                // 병력 규모는 유지하되 하한만 보장한다(음수 방어).
                development: Math.max(0, c.development),
                maxTroops: Math.floor(c.population / 100),
            };
        }

        const factions: AITurnPayload['factions'] = {};
        for (const f of source.getAllFactions()) {
            // 군주 성향 유도: 정책 가중치 중 최대 축으로 판정
            const p = f.policy;
            const temperament: AITurnPayload['factions'][string]['temperament'] =
                p.militaryFocus >= Math.max(p.economyFocus, p.diplomacyFocus) ? 'HEGEMON'
                    : p.diplomacyFocus >= p.economyFocus ? 'RIGHTEOUS'
                        : 'KINGLY';

            const atWarWith: string[] = [];
            const alliedWith: string[] = [];
            for (const [targetId, diplo] of Object.entries(f.diplomacy)) {
                if (diplo.treaty === 'WAR') atWarWith.push(targetId);
                else if (diplo.treaty === 'ALLIANCE') alliedWith.push(targetId);
            }

            factions[f.id] = {
                id: f.id,
                name: f.name,
                leaderId: f.leaderId,
                temperament,
                gold: f.gold,
                food: f.food,
                cityCount: f.cities.length,
                atWarWith,
                alliedWith,
            };
        }

        const officers: AITurnPayload['officers'] = source.getAllOfficers().map(o => ({
            id: o.id,
            name: o.name,
            factionId: o.factionId,
            cityId: o.cityId,
            ambition: o.ambition,
            loyalty: o.loyalty,
            morality: o.morality,
            infamy: o.infamy,
            stats: { ...o.stats },
            isPlayer: playerFactionId !== null && o.factionId === playerFactionId,
        }));

        return {
            year: gs.time.year,
            month: gs.time.month,
            turn: gs.turnCount,
            aiDifficultyMultiplier: resolveAIMonthlyDifficulty(gs.difficulty ?? DEFAULT_DIFFICULTY, gs.turnCount) / DEFAULT_DIFFICULTY,
            protectedFactionId: playerFactionId,
            factions,
            officers,
            cities,
        };
    }

    // ============================================================
    // AI 턴 실행
    // ============================================================

    /** 매달 평정 페이즈 시작 시 호출 — AI 턴을 워커에 위임 */
    startMonthlyTurn(payload: AITurnPayload): Promise<void> {
        if (this.isTurnRunning) {
            return Promise.reject(new Error('AI turn already running'));
        }
        this.isTurnRunning = true;
        const worker = this.ensureWorker();
        return new Promise<void>((resolve) => {
            this.pendingResolve = resolve;
            worker.postMessage({ type: 'START_AI_TURN', payload });
        });
    }

    /** AI 턴 진행 여부 */
    isBusy(): boolean {
        return this.isTurnRunning;
    }

    /** 워커를 종료하고 대기 중인 턴을 안전하게 해제한다. */
    terminate(): void {
        this.worker?.terminate();
        this.worker = null;
        this.isTurnRunning = false;
        this.pendingResolve?.();
        this.pendingResolve = null;
    }
}
