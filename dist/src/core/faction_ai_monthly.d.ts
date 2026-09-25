/**
 * 세력 AI — 월간 자율 행동 [201][K-고급 AI]
 *
 * executeTurn에서 호출되며, 플레이어 세력을 제외한 모든 세력에 대해:
 * 1) 내정: 도시 자금이 충분하면 개발 (developmentStats 상승)
 * 2) 징병: 병력(development)이 적으면 모집
 * 3) 출진: 병력 우위 + 인접 적 도시가 있으면 확률적 공성 (도시 점령)
 *
 * 성향(군주 personality)에 따라 공격성이 달라진다.
 */
import type { GameStore } from './game_store.js';
import { type CaptiveOutcome } from './ai_captive_system.js';
export interface FactionAIMonthlyOptions {
    /** 스트리밍 AI가 이미 커맨드 큐로 내정/징병을 처리한 경우 직접 처리 중복을 방지한다. [201] */
    skipCityDevelopment?: boolean;
}
export interface FactionAIReport {
    factionId: string;
    factionName: string;
    actions: string[];
    conqueredCityId: string | null;
    /** UI/연대기에 전달할 포로 처분 결과 [121-130][131-145] */
    captiveOutcomes?: CaptiveOutcome[];
}
export declare class FactionAI {
    private store;
    /** 포로 등용 원수화 페널티용 외교 엔진 (엔진에서 주입) */
    diplomacy: import('./diplomacy_engine.js').DiplomacyEngine | null;
    constructor(store: GameStore);
    /** 월간 세력 AI 실행 — 플레이어 세력 제외 */
    runMonthly(options?: FactionAIMonthlyOptions): FactionAIReport[];
    private runFaction;
}
//# sourceMappingURL=faction_ai_monthly.d.ts.map