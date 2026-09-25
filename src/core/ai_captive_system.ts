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
import { OfficerStatus } from './types.js';
import { applyCaptiveRecruitPenalty, applyCaptiveReleaseDiplomacy } from './captive_recruit_penalty_system.js';
import { isCaptive, getCapturedOriginFaction, releaseCaptive } from './captive_escape_system.js';
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
export function isCruelLeader(might: number, intelligence: number): boolean {
    return might > intelligence;
}

/** 포로 처형 여부 판정 — 잔혹형 군주는 80%, 온건형은 10% */
export function judgeExecution(cruel: boolean, roll: number): boolean {
    const chance = cruel ? 0.8 : 0.1;
    return roll < chance;
}

/** 포로 등용 성공 확률 — 기본 50% + 군주 카리스마 보정 (최대 +0.3) */
export function judgeCaptiveRecruit(charisma: number, roll: number): boolean {
    const chance = Math.min(0.95, 0.5 + (charisma - 60) / 200);
    return roll < chance;
}

/**
 * AI 포로 외교 판단 [24][341-360] — 등용 시 원수화 페널티를 감수할 가치가 있는지
 *
 * 페널티 회피 유인:
 *  - 이미 전쟁 중인 원소속 세력 → 페널티 추가 부담 없음 (등용 유리)
 *  - 포로 무장이 고능력(능력치 합 350 이상) → 페널티를 감수할 가치
 *  - 온건형 군주는 관계 악화를 꺼려 석방 선호
 */
export function judgeCaptiveDiplomacy(
    alreadyAtWar: boolean,
    statTotal: number,
    cruel: boolean,
    roll: number,
): boolean {
    if (alreadyAtWar) return true;       // 전쟁 중이면 원수화 부담 없음
    if (statTotal >= 350) return true;   // 고능력 포로는 페널티 감수하고 등용
    // 그 외: 잔혹형(무모한) 군주는 60% 확률로 무시, 온건형은 대부분 회피
    return roll < (cruel ? 0.6 : 0.2);
}

/** 통일 전쟁 상태 확인 — diplomacy가 있으면 현재 관계가 WAR인지 */
function isAtWarWith(diplomacy: DiplomacyEngine | null | undefined, aId: string, bId: string): boolean {
    if (!diplomacy) return false;
    return diplomacy.getRelation(aId, bId) === 'war';
}

/**
 * AI 세력의 포로 목록 처리
 * @param factionId 포로를 처리하는 (공성 승리한) 세력 ID
 * @param capturedOfficerIds processBattleSpoils가 반환한 포획 무장 ID 목록
 */
export function processCaptives(
    store: IGameStore,
    factionId: string,
    capturedOfficerIds: string[],
    diplomacy?: DiplomacyEngine,
): CaptiveReport {
    const outcomes: CaptiveOutcome[] = [];
    const messages: string[] = [];

    if (capturedOfficerIds.length === 0) return { outcomes, messages };

    const faction = store.getFaction(factionId);
    if (!faction) return { outcomes, messages };
    const leader = store.getOfficer(faction.leaderId);
    if (!leader) return { outcomes, messages };

    const cruel = isCruelLeader(leader.stats.might, leader.stats.intelligence);
    const cities = store.getCitiesByFaction(factionId);

    for (const officerId of capturedOfficerIds) {
        const officer = store.getOfficer(officerId);
        if (!officer) continue;
        // 유효 포로 판정: 포획 상태(FREE + 무소속 + 충성도 0)여야 처리 대상
        if (officer.status !== OfficerStatus.FREE || officer.factionId !== null || officer.loyalty !== 0) {
            continue;
        }

        const execRoll = Math.random();
        if (judgeExecution(cruel, execRoll)) {
            // 처형: 무장 제거 (인덱스/관계망 정리는 store가 수행)
            store.removeOfficer(officer.id);
            // 명성/악명 연동 [11]: 처형은 악명 상승 + 명성 하락
            store.updateOfficer(leader.id, {
                infamy: Math.min(9999, leader.infamy + 30),
                fame: Math.max(0, leader.fame - 10),
            });
            outcomes.push({
                officerId: officer.id,
                officerName: officer.name,
                decision: 'EXECUTE',
                success: true,
                message: `⚔️ ${leader.name}은(는) 포로 ${officer.name}을(를) 처형했다 (악명 +30)`,
            });
            messages.push(outcomes[outcomes.length - 1].message);
            continue;
        }

        const recruitRoll = Math.random();
        // AI 외교 판단 [341-360]: 원소속 세력과의 관계 부담을 고려해 등용 가능 여부 결정
        const originForJudge = getCapturedOriginFaction(store, officer.id);
        const warBurden = originForJudge ? isAtWarWith(diplomacy, factionId, originForJudge) : true;
        const statTotal = officer.stats.leadership + officer.stats.might + officer.stats.intelligence
            + officer.stats.politics + officer.stats.charisma;
        const diplomacyRoll = Math.random();
        const diplomacyAllows = judgeCaptiveDiplomacy(warBurden, statTotal, cruel, diplomacyRoll);

        if (diplomacyAllows && judgeCaptiveRecruit(leader.stats.charisma, recruitRoll) && cities.length > 0) {
            // 등용: 가장 약한 아군 도시에 배치
            const targetCity = [...cities].sort((a, b) => a.development - b.development)[0];
            store.updateOfficer(officer.id, {
                factionId,
                status: OfficerStatus.OFFICER,
                cityId: targetCity.id,
                loyalty: 50 + Math.floor(Math.random() * 20),
                rank: Math.max(1, officer.rank),
            });
            if (!targetCity.officerIds.includes(officer.id)) {
                store.updateCity(targetCity.id, { officerIds: [...targetCity.officerIds, officer.id] });
            }
            store.updateFaction(factionId, { officers: [...faction.officers, officer.id] });
            const outcomeMessages: string[] = [`🤝 ${officer.name} 포로를 등용했다 (${targetCity.name} 배치)`];
            // 포로 등용 페널티 [24][341-360]: 원소속 세력 원수화 (동맹 파기/선전포고 + 동료 NEMESIS)
            if (diplomacy && isCaptive(store, officer.id)) {
                const penalty = applyCaptiveRecruitPenalty(store, diplomacy, factionId, officer.id);
                outcomeMessages.push(...penalty.messages);
            }
            outcomes.push({
                officerId: officer.id,
                officerName: officer.name,
                decision: 'RECRUIT',
                success: true,
                message: outcomeMessages[0],
            });
            messages.push(outcomes[outcomes.length - 1].message);
        } else {
            // 실패/기피: 재야 석방 (충성도 0 유지 — 플레이어 등용 대상으로 전환)
            // 포로 마커를 해제해야 수용 기간/탈출 판정에서 즉시 제외된다. [131-145]
            releaseCaptive(store, officer.id);
            const releaseMessages: string[] = [`🕊️ ${officer.name} 포로를 풀어주었다`];
            // 석방 외교 효과 [341-360]: 원소속 세력이 살아있으면 관계 개선 (전쟁 중이면 휴전 시도)
            if (diplomacy) {
                const releaseDiplo = applyCaptiveReleaseDiplomacy(store, diplomacy, factionId, officer.id);
                releaseMessages.push(...releaseDiplo.messages);
            }
            // 명성/악명 연동 [11]: 석방은 명성 상승 (인도적 평판)
            store.updateOfficer(leader.id, {
                fame: Math.min(9999, leader.fame + 15),
            });
            releaseMessages.push(`✨ ${leader.name}의 명성이 높아졌습니다 (명성 +15)`);
            outcomes.push({
                officerId: officer.id,
                officerName: officer.name,
                decision: 'RELEASE',
                success: false,
                message: releaseMessages[0],
            });
            messages.push(...releaseMessages);
        }
    }

    return { outcomes, messages };
}
