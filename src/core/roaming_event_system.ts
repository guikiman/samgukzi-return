/**
 * 로밍 이벤트 시스템 [25][441-460] — 재야 명사 방문
 *
 * 매월 플레이어/AI 세력 도시에 확률적으로 방문객이 찾아온다:
 *  - SAGE(현자):   정치 상담 → 도시 기술 +8 / 세력 명성 소폭 상승
 *  - HERMIT(은자): 선양 → 군주 fame +15
 *  - MERCHANT(상인): 물물교역 → 세력 자금 +300
 *  - TRAVELER(행상인): 소문 전달 → 도시 치안 +5
 *  - BANDIT(산적): 습격 → 도시 자금 −200 / 치안 −5 (치안 낮은 도시에서만)
 *
 * 기존 EncounterMatcher(encounter_matcher.ts)의 판정표를 재사용해
 * 지형/계절/치안 기반 확률을 산출하고, 결과를 스토어에 적용한다.
 * 이벤트는 GAME_ROAMING_EVENT 타입으로 발화해 UI 로그와 연결된다.
 */

import type { GameStore } from './game_store.js';
import { EncounterMatcher, type EncounterType } from './encounter_matcher.js';
import { getDifficultyMultiplier } from './difficulty_balance_system.js';

/** 방문 이벤트 결과 */
export interface RoamingEventResult {
    /** 방문자 유형 */
    type: EncounterType;
    /** 발생 도시 */
    cityId: string;
    /** 도시명 */
    cityName: string;
    /** 세력명 (무주공산이면 null) */
    factionName: string | null;
    /** 게임 로그용 메시지 */
    message: string;
    /** 플레이어 세력 도시 → 자동 적용 대신 대화 선택지 제공 [25][461-480] */
    needsPlayerChoice: boolean;
}

/** 월간 처리 리포트 */
export interface RoamingEventReport {
    events: RoamingEventResult[];
}

/** 로밍 판정 대상 도시 수 상한 (성능 보호 — 매월 최대 8개 도시만 판정) */
const MAX_CITY_ROLLS_PER_MONTH = 8;

/** 상인 교역 수익 */
export const MERCHANT_PROFIT = 300;
/** 현자 기술 상담 효과 */
export const SAGE_TECH_BOOST = 8;
/** 은자 선양 명성 효과 */
export const HERMIT_FAME_BOOST = 15;
/** 행상인 소문 치안 효과 */
export const TRAVELER_ORDER_BOOST = 5;
/** 산적 약탈 금액 */
export const BANDIT_PLUNDER = 200;
export const HUNT_GRAIN = 240;
export const BEAST_ORDER_LOSS = 8;

/** 계절 이름 → encounter_matcher 계절 키 */
function seasonKey(month: number): string {
    if (month <= 2 || month === 12) return 'WINTER';
    if (month <= 5) return 'SPRING';
    if (month <= 8) return 'SUMMER';
    return 'AUTUMN';
}

/** 도시 지형 키 (hex terrain 추정 — 인접 정보가 없으므로 도시 ID 해시 기반 결정) */
function terrainKeyFor(city: { id: string }): string {
    let h = 0;
    for (let i = 0; i < city.id.length; i++) h = (h * 31 + city.id.charCodeAt(i)) | 0;
    const keys = ['PLAIN', 'FOREST', 'MOUNTAIN', 'RIVER'];
    return keys[Math.abs(h) % keys.length];
}

/**
 * 월간 로밍 이벤트 판정 + 적용. 엔진 월간 주기에서 호출.
 */
export function processMonthlyRoamingEvents(store: GameStore): RoamingEventReport {
    const events: RoamingEventResult[] = [];
    const gs = store.getGlobalState();
    const cities = store.getAllCities();
    if (cities.length === 0) return { events };

    const season = seasonKey(gs.time.month);
    const matcher = new EncounterMatcher();

    // 매월 일부 도시만 샘플링해 판정 (성능 + 이벤트 빈도 조절, 난이도 배율 반영) [X-난이도]
    const mult = getDifficultyMultiplier(store);
    const sampleSize = Math.min(cities.length, Math.max(1, Math.round(MAX_CITY_ROLLS_PER_MONTH * mult.roamingFrequency)));
    const shuffled = cities.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const sample = shuffled.slice(0, sampleSize);

    for (const city of sample) {
        // 도시 대표 무장의 명성을 컨텍스트에 반영 (현자/은자는 명성이 높은 도시를 찾아온다)
        const repOfficer = city.officerIds
            .map(id => store.getOfficer(id))
            .find(o => o !== null);
        const officerFame = repOfficer?.fame ?? 0;

        matcher.setContext({
            terrain: terrainKeyFor(city),
            season,
            publicOrder: city.developmentStats.publicOrder,
            isNight: false,
            officerFame,
        });
        const result = matcher.rollForEncounter();
        if (!result || !result.triggered) continue;

        const faction = city.ownerId ? store.getFaction(city.ownerId) : null;
        const factionName = faction?.name ?? null;

        switch (result.type) {
            case 'SAGE': {
                const ds = city.developmentStats;
                store.updateCity(city.id, {
                    developmentStats: {
                        ...ds,
                        technology: Math.min(ds.maxTechnology, ds.technology + SAGE_TECH_BOOST),
                    },
                });
                events.push({
                    type: 'SAGE', cityId: city.id, cityName: city.name, factionName,
                    needsPlayerChoice: false,
                    message: `🧙 현자가 ${city.name}을(를) 방문해 기술을 가르쳤습니다 (기술 +${SAGE_TECH_BOOST})`,
                });
                break;
            }
            case 'HERMIT': {
                if (faction) {
                    const leader = store.getOfficer(faction.leaderId);
                    if (leader) {
                        store.updateOfficer(leader.id, {
                            fame: Math.min(9999, leader.fame + HERMIT_FAME_BOOST),
                        });
                events.push({
                    type: 'HERMIT', cityId: city.id, cityName: city.name, factionName,
                    needsPlayerChoice: false,
                    message: `🍃 은자가 ${faction.name} 군주 ${leader.name}에게 선양을 전했습니다 (명성 +${HERMIT_FAME_BOOST})`,
                });
                    }
                }
                break;
            }
            case 'MERCHANT': {
                if (faction) {
                    store.updateFaction(faction.id, {
                        gold: faction.gold + MERCHANT_PROFIT,
                    });
                events.push({
                    type: 'MERCHANT', cityId: city.id, cityName: city.name, factionName,
                    needsPlayerChoice: false,
                    message: `🐫 상인단이 ${city.name}에서 교역했습니다 (자금 +${MERCHANT_PROFIT})`,
                });
                }
                break;
            }
            case 'TRAVELER': {
                const ds = city.developmentStats;
                store.updateCity(city.id, {
                    developmentStats: {
                        ...ds,
                        publicOrder: Math.min(ds.maxPublicOrder, ds.publicOrder + TRAVELER_ORDER_BOOST),
                    },
                });
                events.push({
                    type: 'TRAVELER', cityId: city.id, cityName: city.name, factionName,
                    needsPlayerChoice: false,
                    message: `🧳 행상인이 ${city.name}의 온갖 소문을 전했습니다 (치안 +${TRAVELER_ORDER_BOOST})`,
                });
                break;
            }
            case 'BANDIT': {
                // 산적은 치안이 낮은 도시에서만 발생 (matcher가 이미 safetyFactor로 가중)
                // 피해는 난이도 배율 반영 — 높은 난이도일수록 약탈 피해 커짐 [X-난이도]
                const plunder = Math.round(BANDIT_PLUNDER * mult.banditScale);
                store.updateCity(city.id, {
                    funds: Math.max(0, city.funds - plunder),
                });
                events.push({
                    type: 'BANDIT', cityId: city.id, cityName: city.name, factionName,
                    needsPlayerChoice: false,
                    message: `🗡️ 산적이 ${city.name}을(를) 약탈했습니다 (자금 −${plunder})`,
                });
                break;
            }
            case 'HUNT': {
                if (faction) {
                    store.updateFaction(faction.id, { food: faction.food + HUNT_GRAIN });
                }
                events.push({
                    type: 'HUNT', cityId: city.id, cityName: city.name, factionName,
                    needsPlayerChoice: false,
                    message: `🏹 사냥꾼이 ${city.name} 근처에서 식량을 얻었습니다 (식량 +${HUNT_GRAIN})`,
                });
                break;
            }
            case 'BEAST': {
                const ds = city.developmentStats;
                store.updateCity(city.id, {
                    developmentStats: {
                        ...ds,
                        publicOrder: Math.max(0, ds.publicOrder - BEAST_ORDER_LOSS),
                    },
                });
                events.push({
                    type: 'BEAST', cityId: city.id, cityName: city.name, factionName,
                    needsPlayerChoice: false,
                    message: `🐗 야수가 ${city.name} 근처를 헤집고 다녔습니다 (치안 −${BEAST_ORDER_LOSS})`,
                });
                break;
            }
        }
    }

    return { events };
}
