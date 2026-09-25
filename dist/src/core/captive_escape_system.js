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
import { OfficerStatus } from './types.js';
export const CAPTURE_MARKER_EVENT = 'CAPTURED';
export const ESCAPE_EVENT = 'ESCAPED';
export const RELEASE_EVENT = 'RESCUED';
/** 월간 기본 탈출 확률 */
export const BASE_ESCAPE_CHANCE = 0.15;
/** 지력 탈출 보정 계수 (지력 100 → +15%p) */
const INT_ESCAPE_FACTOR = 0.0015;
/** 탈출 확률 상한 */
const MAX_ESCAPE_CHANCE = 0.5;
/** 마지막 포로 관련 마커 이벤트 조회 (자기-엣지 history 기준)
 *  CAPTURED 마커는 `CAPTURED@<세력ID>` 접미사를 가질 수 있으므로 startsWith로 매칭 */
function lastCaptiveEvent(store, officerId) {
    const edge = store.getRelationships(officerId).find(e => e.source === officerId && e.target === officerId);
    if (!edge)
        return null;
    const markers = edge.history.filter(h => h.event === CAPTURE_MARKER_EVENT || h.event.startsWith(CAPTURE_MARKER_EVENT + '@')
        || h.event === ESCAPE_EVENT || h.event === RELEASE_EVENT);
    return markers.length > 0 ? markers[markers.length - 1].event : null;
}
/** 포로 여부 판별 — FREE + 무소속 + 충성도 0 + 마지막 마커가 CAPTURED(@접미사 포함) */
export function isCaptive(store, officerId) {
    const o = store.getOfficer(officerId);
    if (!o)
        return false;
    if (o.status !== OfficerStatus.FREE || o.factionId !== null || o.loyalty !== 0)
        return false;
    const last = lastCaptiveEvent(store, officerId);
    return last === CAPTURE_MARKER_EVENT || (last?.startsWith(CAPTURE_MARKER_EVENT + '@') ?? false);
}
/** 포획 직후 호출 — 포로를 공격자(수용) 도시에 배치하고 포로 마커를 남긴다
 *  마커 이벤트는 `CAPTURED@<원소속세력ID>` 형태로 원소속 세력을 함께 기록한다
 *  (무소속 재야 출신이면 접미사 없음) — 등용 시 원소속 세력 원수화 페널티용 [24]
 */
export function imprisonCaptive(store, officerId, holdingCityId, originFactionId) {
    const officer = store.getOfficer(officerId);
    if (!officer || !store.getCity(holdingCityId))
        return;
    store.updateOfficer(officerId, { cityId: holdingCityId });
    // 자기-엣지가 없으면 생성 (addRelationship이 역방향 사본도 인덱스에 추가하지만 self-edge라 무해)
    let selfEdge = store.getRelationships(officerId).find(e => e.source === officerId && e.target === officerId);
    if (!selfEdge) {
        store.addRelationship({
            source: officerId,
            target: officerId,
            type: 'FRIEND',
            affinity: 0,
            history: [],
        });
        selfEdge = store.getRelationships(officerId).find(e => e.source === officerId && e.target === officerId);
    }
    if (!selfEdge)
        return;
    const { year, month } = store.getGlobalState().time;
    // 원소속 세력: 호출측이 명시 전달 우선, 없으면 현재 소속(포획 후면 이미 null)
    const origin = originFactionId !== undefined ? originFactionId : officer.factionId;
    const originSuffix = origin ? `@${origin}` : '';
    selfEdge.history.push({ year, month, event: CAPTURE_MARKER_EVENT + originSuffix, delta: 0 });
}
/**
 * 포로의 원소속 세력(포획 당시 소속) 조회 — 등용 페널티용 [24]
 * 마지막 CAPTURED 마커의 `@<세력ID>` 접미사를 파싱한다.
 * 접미사가 없거나 세력이 이미 멸망(스토어 제거)했으면 null을 반환한다.
 */
export function getCapturedOriginFaction(store, officerId) {
    const edge = store.getRelationships(officerId).find(e => e.source === officerId && e.target === officerId);
    if (!edge)
        return null;
    const markers = edge.history.filter(h => h.event.startsWith(CAPTURE_MARKER_EVENT));
    if (markers.length === 0)
        return null;
    const last = markers[markers.length - 1];
    const at = last.event.indexOf('@');
    if (at === -1)
        return null;
    const factionId = last.event.slice(at + 1);
    // 멸망으로 스토어에서 제거된 세력이면 페널티 대상 아님
    return store.getFaction(factionId) ? factionId : null;
}
/** 마커 해제 — 탈출/석방 시점에 이력을 남긴다 */
function releaseMarker(store, officerId, event) {
    const selfEdge = store.getRelationships(officerId).find(e => e.source === officerId && e.target === officerId);
    if (!selfEdge)
        return;
    const { year, month } = store.getGlobalState().time;
    selfEdge.history.push({ year, month, event, delta: 0 });
}
/** 탈출 확률 계산 (순수 함수) — 지력이 높을수록 탈출에 유리 */
export function judgeEscape(intelligence, roll) {
    const chance = Math.min(MAX_ESCAPE_CHANCE, BASE_ESCAPE_CHANCE + intelligence * INT_ESCAPE_FACTOR);
    return roll < chance;
}
/**
 * 월간 포로 이벤트 — 자의 탈출 판정.
 * 엔진의 월간 주기(배신 판정 근처)에서 호출한다.
 */
export function processMonthlyCaptiveEvents(store) {
    const escaped = [];
    const messages = [];
    const captives = store.getAllOfficers().filter(o => isCaptive(store, o.id));
    for (const c of captives) {
        if (!judgeEscape(c.stats.intelligence, Math.random()))
            continue;
        const fromCityId = c.cityId;
        releaseMarker(store, c.id, ESCAPE_EVENT);
        store.updateOfficer(c.id, { cityId: null });
        const record = {
            officerId: c.id,
            officerName: c.name,
            fromCityId,
            message: `🏃 ${c.name}이(가) 포로수용소에서 탈출했습니다`,
        };
        escaped.push(record);
        messages.push(record.message);
    }
    return { escaped, messages };
}
/** 개별 포로 석방 — 포로 마커를 해제해 AI 처분 후 즉시 수용 기간에서 제외한다. [121-130] */
export function releaseCaptive(store, officerId) {
    if (!isCaptive(store, officerId))
        return;
    releaseMarker(store, officerId, RELEASE_EVENT);
}
/**
 * 구출(석방) — 수용 도시가 함락됐을 때 그 도시의 포로를 모두 석방한다.
 * 함락 소유권 변경 직후(플레이어 원정 승리 / AI 공성 승리)에 호출.
 * 석방된 포로는 그 도시에 재야로 남는다 (새 소유자가 등용 가능).
 */
export function releaseCaptivesInCity(store, cityId) {
    const released = [];
    for (const o of store.getOfficersByCity(cityId)) {
        if (!isCaptive(store, o.id))
            continue;
        releaseCaptive(store, o.id);
        released.push({
            officerId: o.id,
            officerName: o.name,
            fromCityId: cityId,
            message: `🔓 ${o.name} 석방 — 수용 도시가 함락되었습니다`,
        });
    }
    return released;
}
/** 특정 도시에 수용 중인 포로 목록 (UI 배지용) */
export function getCaptivesInCity(store, cityId) {
    return store.getOfficersByCity(cityId)
        .filter(o => isCaptive(store, o.id))
        .map(o => ({ id: o.id, name: o.name }));
}
//# sourceMappingURL=captive_escape_system.js.map