/**
 * 전투 후처리 시스템 [131-145: 전투 심화] — 포로·약탈
 *
 * 공성 승리 직후 호출되며:
 * 1) 포로 포획: 수비 도시 무장 중 일부를 포획 (포획률은 지력/도주 반영)
 *    - 포획된 무장은 재야화(FREE) + 충성도 0 + 도시에서 이탈 → 등용 시스템의 대상이 됨 [24]
 * 2) 병력 약탈: 수비 도시 병력(development)의 일부를 공격자 도시로 이송
 * 3) 자원 수탈: 수비 도시 자금(funds)과 소속 세력 국고의 일부를 약탈
 *
 * 순수 함수형 계산 + 스토어 적용 분리로 테스트 용이성 확보.
 */
import type { Officer, OfficerID, IGameStore } from './types.js';
/** 포획 확률 기본값 (무장 1명당) */
export declare const BASE_CAPTURE_CHANCE = 0.35;
/** 지력이 높으면 도주 확률 가산 (지력 100 → +25%p 감소) */
export declare const INT_ESCAPE_FACTOR = 0.0025;
/** 병력 약탈 비율 (수비 도시 development 기준) */
export declare const TROOP_PLUNDER_RATIO = 0.25;
/** 자금 약탈 비율 (수비 도시 funds 기준) */
export declare const FUND_PLUNDER_RATIO = 0.4;
/** 세력 국고 약탈 비율 (수비 세력 gold 기준) */
export declare const FACTION_GOLD_PLUNDER_RATIO = 0.2;
export interface SpoilsResult {
    /** 포획된 무장 ID 목록 */
    capturedOfficerIds: OfficerID[];
    /** 도주한 무장 ID 목록 */
    escapedOfficerIds: OfficerID[];
    /** 약탈한 병력 수 */
    troopsPlundered: number;
    /** 약탈한 도시 자금 */
    fundsPlundered: number;
    /** 약탈한 세력 국고 */
    factionGoldPlundered: number;
    /** 로그 메시지 목록 */
    messages: string[];
}
/**
 * 포획 판정 (순수 함수) — 지력이 높은 무장은 도주 확률이 낮다
 * 포획률 = BASE_CAPTURE_CHANCE - 지력 × 0.0025 (지력 100 → 10%p 감소), 최저 5%
 */
export declare function judgeCapture(officer: Officer, roll: number): boolean;
/**
 * 승리 후 전리품 계산 + 스토어 적용
 *
 * @param attackerCityId 공격자 출발 도시
 * @param defenderCityId 함락된 수비 도시
 * @param rolls 포획 판정용 난수 (무장별 0~1, 테스트 주입용 — 없으면 Math.random)
 */
export declare function processBattleSpoils(store: IGameStore, attackerCityId: string, defenderCityId: string, rolls?: Array<{
    officerId: OfficerID;
    roll: number;
}>): SpoilsResult;
//# sourceMappingURL=battle_spoils_system.d.ts.map