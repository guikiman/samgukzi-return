/**
 * AI 포로 후처리 시스템 [121-130: AI 행동] [131-145: 전투 심화]
 *
 * AI 세력이 공성 승리 후 processBattleSpoils로 포획한 포로를 처리한다:
 *  - 군주 성향 판정: 무력 > 지력 → 포로 처형(잔혹형), 그 외 → 등용 시도
 *  - 등용: 성공 시 아군 도시에 배치 (확률 = 0.5 + 카리스마 보정)
 *  - 처형: removeOfficer로 제거 (역사 기록용 로그 반환)
 *  - 등용 실패 시 포로는 재야로 풀어준다 (충성도 0 유지)
 *
 * 순수 판정 함수 + 스토어 적용 분리로 테스트 용이성 확보.
 */
import type { IGameStore } from './types.js';
import type { DiplomacyEngine } from './diplomacy_engine.js';
export type CaptiveDecision = 'RECRUIT' | 'EXECUTE' | 'RELEASE';
export interface CaptiveOutcome {
    officerId: string;
    officerName: string;
    decision: CaptiveDecision;
    success: boolean;
    message: string;
}
export interface CaptiveReport {
    outcomes: CaptiveOutcome[];
    messages: string[];
}
/** 군주 성향 판정 — 무력이 지력보다 크면 잔혹형(처형 성향) */
export declare function isCruelLeader(might: number, intelligence: number): boolean;
/** 포로 처형 여부 판정 — 잔혹형 군주는 80%, 온건형은 10% */
export declare function judgeExecution(cruel: boolean, roll: number): boolean;
/** 포로 등용 성공 확률 — 기본 50% + 군주 카리스마 보정 (최대 +0.3) */
export declare function judgeCaptiveRecruit(charisma: number, roll: number): boolean;
/**
 * AI 포로 외교 판단 [24][341-360] — 등용 시 원수화 페널티를 감수할 가치가 있는지
 *
 * 페널티 회피 유인:
 *  - 이미 전쟁 중인 원소속 세력 → 페널티 추가 부담 없음 (등용 유리)
 *  - 포로 무장이 고능력(능력치 합 350 이상) → 페널티를 감수할 가치
 *  - 온건형 군주는 관계 악화를 꺼려 석방 선호
 */
export declare function judgeCaptiveDiplomacy(alreadyAtWar: boolean, statTotal: number, cruel: boolean, roll: number): boolean;
/**
 * AI 세력의 포로 목록 처리
 * @param factionId 포로를 처리하는 (공성 승리한) 세력 ID
 * @param capturedOfficerIds processBattleSpoils가 반환한 포획 무장 ID 목록
 */
export declare function processCaptives(store: IGameStore, factionId: string, capturedOfficerIds: string[], diplomacy?: DiplomacyEngine): CaptiveReport;
//# sourceMappingURL=ai_captive_system.d.ts.map