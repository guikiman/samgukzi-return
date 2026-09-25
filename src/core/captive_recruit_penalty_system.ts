/**
 * 포로 등용 페널티 시스템 [24] [C-인간관계] [341-360]
 *
 * 포로를 등용하면 원소속 세력(포획 당시 소속)이 이를 적대적으로 받아들인다:
 *  1) 세력 외교 악화: 등용한 세력 ↔ 원소속 세력 관계가
 *     동맹이면 파기, 전쟁 중이 아니면 전쟁 상태로 전환 (원수화)
 *  2) 동료 원수화: 원소속 세력의 남은 무장들은 등용당한 무장을
 *     NEMESIS(원수)로 기억 — 우호도 -60, 관계 유형 원수화
 *
 * 마커는 imprisonCaptive가 기록한 `CAPTURED@<세력ID>` self-edge 이력에서
 * 원소속 세력을 조회한다 (세이브 호환 — Officer 인터페이스 변경 없음).
 */

import type { IGameStore, RelationshipEdge } from './types.js';
import { getCapturedOriginFaction } from './captive_escape_system.js';
import { DiplomacyEngine, FactionRelation } from './diplomacy_engine.js';

/** 등용당한 무장에 대한 동료의 원수화 우호도 감소량 */
export const NEMESIS_AFFINITY_DROP = -60;

/** 관계 이력 이벤트명 */
export const COMRADE_NEMESIS_EVENT = 'COMRADE_RECRUITED_NEMESIS';

/** 등용 페널티 결과 */
export interface CaptiveRecruitPenaltyResult {
    /** 원소속 세력 ID (페널티 대상이 없으면 null) */
    originFactionId: string | null;
    /** 외교 관계 전환 결과 메시지 (전환 없으면 null) */
    diplomacyMessage: string | null;
    /** 원수화된 동료 무장 ID 목록 */
    nemesisComradeIds: string[];
    /** 로그 메시지 목록 */
    messages: string[];
}

/**
 * 포로 등용 후처리 — 원소속 세력과의 원수화 페널티 적용.
 * recruit() 성공 직후(포로 출신 무장만) 호출한다.
 *
 * @param store 게임 스토어
 * @param diplomacy 세력 외교 엔진 (엔진 소유 인스턴스 — 세이브 직렬화 대상)
 * @param recruitedFactionId 등용시킨 세력 ID
 * @param recruitedOfficerId 등용당한 무장 ID
 */
export function applyCaptiveRecruitPenalty(
    store: IGameStore,
    diplomacy: DiplomacyEngine,
    recruitedFactionId: string,
    recruitedOfficerId: string,
): CaptiveRecruitPenaltyResult {
    const messages: string[] = [];
    const result: CaptiveRecruitPenaltyResult = {
        originFactionId: null,
        diplomacyMessage: null,
        nemesisComradeIds: [],
        messages,
    };

    const officer = store.getOfficer(recruitedOfficerId);
    if (!officer) return result;

    const originFactionId = getCapturedOriginFaction(store, recruitedOfficerId);
    if (!originFactionId || originFactionId === recruitedFactionId) return result;
    result.originFactionId = originFactionId;

    // 1) 세력 외교 악화 — 동맹이면 파기, 전쟁 중이 아니면 선전포고 (원수화) [341-360]
    const originName = store.getFaction(originFactionId)?.name ?? originFactionId;
    const current = diplomacy.getRelation(recruitedFactionId, originFactionId);
    if (current === FactionRelation.ALLIANCE) {
        const r = diplomacy.breakAlliance(recruitedFactionId, originFactionId);
        result.diplomacyMessage = r.message;
        messages.push(`🕊️ [외교] ${originName}: ${r.message} — 포로 등용에 대한 응징`);
    } else if (current !== FactionRelation.WAR && current !== FactionRelation.SURRENDERED) {
        const r = diplomacy.declareWar(originFactionId, recruitedFactionId);
        result.diplomacyMessage = r.message;
        messages.push(`⚔️ [외교] ${originName}: ${r.message} — 포로 등용에 대한 원수화`);
    }

    // 2) 동료 원수화 — 원소속 세력의 남은 무장들이 등용당한 무장을 원수로 기억 [C-인간관계]
    const { year, month } = store.getGlobalState().time;
    const originOfficers = store.getOfficersByFaction(originFactionId)
        .filter(o => o.id !== recruitedOfficerId);

    for (const comrade of originOfficers) {
        const forward = store.getRelationships(comrade.id).find(e => e.target === recruitedOfficerId);
        const reverse = store.getRelationships(recruitedOfficerId).find(e => e.target === comrade.id);

        if (forward || reverse) {
            // 기존 엣지 — 원수화 (양방향 사본 모두 동기화, -100 클램프)
            for (const edge of [forward, reverse] as RelationshipEdge[]) {
                if (!edge) continue;
                edge.affinity = Math.max(-100, edge.affinity + NEMESIS_AFFINITY_DROP);
                edge.type = 'NEMESIS';
                edge.history.push({ year, month, event: COMRADE_NEMESIS_EVENT, delta: NEMESIS_AFFINITY_DROP });
            }
        } else {
            // 신규 엣지 생성 (addRelationship이 양방향 인덱스 동시 갱신)
            store.addRelationship({
                source: comrade.id,
                target: recruitedOfficerId,
                type: 'NEMESIS',
                affinity: NEMESIS_AFFINITY_DROP,
                history: [{ year, month, event: COMRADE_NEMESIS_EVENT, delta: NEMESIS_AFFINITY_DROP }],
            });
        }
        result.nemesisComradeIds.push(comrade.id);
    }

    if (result.nemesisComradeIds.length > 0) {
        messages.push(`💢 ${originName} 잔여 무장 ${result.nemesisComradeIds.length}명이 ${officer.name}을(를) 원수로 여깁니다`);
    }

    return result;
}

/** 석방 시 우호도/외교 개선량 */
export const RELEASE_GOODWILL_PEACE_CHANCE = 0.5;

/** 석방 선포 결과 */
export interface CaptiveReleaseDiplomacyResult {
    /** 원소속 세력 ID (없으면 null) */
    originFactionId: string | null;
    /** 휴전 성립 여부 */
    peaceMade: boolean;
    /** 로그 메시지 목록 */
    messages: string[];
}

/**
 * 석방 선포 시스템 [341-360] — 포로를 풀어주면 원소속 세력이 goodwill을 갚는다.
 *
 *  - 전쟁 중이면 50% 확률로 휴전 성립 (인도적 석방에 대한 화답)
 *  - 석방한 세력의 평판(reputation) 소폭 상승
 *
 * processCaptives의 RELEASE 경로와 플레이어 수동 석방에서 호출한다.
 */
export function applyCaptiveReleaseDiplomacy(
    store: IGameStore,
    diplomacy: DiplomacyEngine,
    releaserFactionId: string,
    releasedOfficerId: string,
): CaptiveReleaseDiplomacyResult {
    const messages: string[] = [];
    const result: CaptiveReleaseDiplomacyResult = { originFactionId: null, peaceMade: false, messages };

    const officer = store.getOfficer(releasedOfficerId);
    if (!officer) return result;

    const originFactionId = getCapturedOriginFaction(store, releasedOfficerId);
    if (!originFactionId || originFactionId === releaserFactionId) return result;
    result.originFactionId = originFactionId;

    const originName = store.getFaction(originFactionId)?.name ?? originFactionId;

    // 전쟁 중이면 확률적 휴전 — 석방의 인도적 화답
    if (diplomacy.getRelation(releaserFactionId, originFactionId) === FactionRelation.WAR
        && Math.random() < RELEASE_GOODWILL_PEACE_CHANCE) {
        const r = diplomacy.makePeace(releaserFactionId, originFactionId);
        if (r.success) {
            result.peaceMade = true;
            messages.push(`🕊️ [외교] ${originName}: 포로 석방에 대한 화답으로 휴전이 성립되었습니다`);
        }
    }

    // 석방한 세력 평판 상승 [212 계열 — 명성 시스템]
    const releaser = store.getFaction(releaserFactionId);
    if (releaser) {
        store.updateFaction(releaserFactionId, { reputation: Math.min(100, releaser.reputation + 2) });
    }

    return result;
}
