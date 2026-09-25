/**
 * 포로 탈출/구출 시스템 [131-145: 전투 심화]
 *
 * processBattleSpoils가 포획한 포로는 공격자 도시에 수용된다(imprisonCaptive).
 * 이 시스템은 그 이후의 생애 주기를 담당한다:
 *  - 월간 자의 탈출 판정: 지력이 높을수록 탈출 확률 상승 (기본 15% + 지력 보정, 최대 50%)
 *  - 구출(석방): 수용 도시가 다른 세력에게 함락되면 그 도시의 포로는 모두 석방된다
 *
 * 포로 판별은 Officer 자기-엣지(self edge)의 history 마커로 한다:
 *   CAPTURED → ESCAPED/RESCUED 순서로 마지막 마커가 CAPTURED이고
 *   상태가 FREE + 무소속 + 충성도 0이면 포로로 간주한다.
 * (Officer 인터페이스 변경 없이 세이브 호환성 유지)
 */
import type { IGameStore } from './types.js';
export declare const CAPTURE_MARKER_EVENT = "CAPTURED";
export declare const ESCAPE_EVENT = "ESCAPED";
export declare const RELEASE_EVENT = "RESCUED";
/** 월간 기본 탈출 확률 */
export declare const BASE_ESCAPE_CHANCE = 0.15;
/** 포로 여부 판별 — FREE + 무소속 + 충성도 0 + 마지막 마커가 CAPTURED(@접미사 포함) */
export declare function isCaptive(store: IGameStore, officerId: string): boolean;
/** 포획 직후 호출 — 포로를 공격자(수용) 도시에 배치하고 포로 마커를 남긴다
 *  마커 이벤트는 `CAPTURED@<원소속세력ID>` 형태로 원소속 세력을 함께 기록한다
 *  (무소속 재야 출신이면 접미사 없음) — 등용 시 원소속 세력 원수화 페널티용 [24]
 */
export declare function imprisonCaptive(store: IGameStore, officerId: string, holdingCityId: string, originFactionId?: string | null): void;
/**
 * 포로의 원소속 세력(포획 당시 소속) 조회 — 등용 페널티용 [24]
 * 마지막 CAPTURED 마커의 `@<세력ID>` 접미사를 파싱한다.
 * 접미사가 없거나 세력이 이미 멸망(스토어 제거)했으면 null을 반환한다.
 */
export declare function getCapturedOriginFaction(store: IGameStore, officerId: string): string | null;
/** 탈출 확률 계산 (순수 함수) — 지력이 높을수록 탈출에 유리 */
export declare function judgeEscape(intelligence: number, roll: number): boolean;
export interface CaptiveEscapeRecord {
    officerId: string;
    officerName: string;
    fromCityId: string | null;
    message: string;
}
export interface CaptiveMonthlyReport {
    escaped: CaptiveEscapeRecord[];
    messages: string[];
}
/**
 * 월간 포로 이벤트 — 자의 탈출 판정.
 * 엔진의 월간 주기(배신 판정 근처)에서 호출한다.
 */
export declare function processMonthlyCaptiveEvents(store: IGameStore): CaptiveMonthlyReport;
/** 개별 포로 석방 — 포로 마커를 해제해 AI 처분 후 즉시 수용 기간에서 제외한다. [121-130] */
export declare function releaseCaptive(store: IGameStore, officerId: string): void;
/**
 * 구출(석방) — 수용 도시가 함락됐을 때 그 도시의 포로를 모두 석방한다.
 * 함락 소유권 변경 직후(플레이어 원정 승리 / AI 공성 승리)에 호출.
 * 석방된 포로는 그 도시에 재야로 남는다 (새 소유자가 등용 가능).
 */
export declare function releaseCaptivesInCity(store: IGameStore, cityId: string): CaptiveEscapeRecord[];
/** 특정 도시에 수용 중인 포로 목록 (UI 배지용) */
export declare function getCaptivesInCity(store: IGameStore, cityId: string): Array<{
    id: string;
    name: string;
}>;
//# sourceMappingURL=captive_escape_system.d.ts.map