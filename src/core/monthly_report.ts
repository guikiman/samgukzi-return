/**
 * 월간 보고서 [E1-361 연계] — 월말 정산 후 수입/지출/AI 행동 요약
 * + 포팅 시스템 월간 동향 섹션 [76-85][321-340][341-360][421-438]
 */

import type { GameStore } from './game_store.js';

export interface MonthlyReport {
    year: number;
    month: number;
    turnCount: number;
    /** 플레이어 세력 재정 */
    playerGold: number;
    playerFood: number;
    goldIncome: number;
    foodIncome: number;
    /** 도시별 요약 */
    cities: Array<{ name: string; funds: number; development: number; commerce: number; farming: number }>;
    /** AI 세력 요약 */
    factions: Array<{ name: string; gold: number; cities: number; officers: number }>;
    /** 포팅 시스템 월간 동향 — 엔진의 processPortedSystemsMonthly가 수집 [76-85][321-340][341-360][421-438] */
    ported?: PortedMonthlySection | null;
}

export interface PortedMonthlySection {
    /** 이번 달 완료된 출진 명령 [77] */
    campaigns: Array<{ targetCity: string; leaderName: string; soldiers: number }>;
    /** 이번 달 완료된 수송 명령 [78] */
    transports: Array<{ fromCity: string; toCity: string; gold: number; food: number; soldiers: number }>;
    /** 붕괴한 첩보망 — 유지비 미납 [346] */
    collapsedNetworks: Array<{ factionId: string; cityId: string }>;
    /** 지역 기후 현황 [321-340] */
    climates: Array<{ regionId: string; weather: string; temperature: number; harvestModifier: number }>;
    /** 이번 달 은퇴한 무장 [434] */
    retired: Array<{ officerName: string; age: number }>;
    /** 전투 후 포로 처분 결과 [121-130][131-145] */
    captives: Array<{ officerId: string; officerName: string; decision: 'RECRUIT' | 'EXECUTE' | 'RELEASE'; success: boolean; message: string }>;
    /** [83] 방랑군 동향 — 전환/등용/습격/재기 */
    vagrant: Array<{ factionName: string; kind: 'CONVERT' | 'RECRUIT' | 'RAID'; success: boolean; message: string }>;
    /** 도시별 기후 표 [321-340] — 소유 세력 포함. climates가 비어도 도시 행은 표시 */
    cityClimates: Array<{ cityName: string; regionId: string; weather: string; temperature: number; harvestModifier: number; ownerId: string | null }>;
}

/**
 * 도시 → 기후 지역 매핑 [321-340]
 * 거점의 지리적 위치(위도/강수)에 따라 4개 기후권으로 배정.
 * 도시명에 지역 키워드가 포함되면 해당 기후권, 그 외에는 지도 좌표로 결정.
 */
export function resolveCityClimateRegion(cityName: string, mapX?: number, mapY?: number): string {
    if (cityName.includes('北') || cityName.includes('북')
        || /딥|평강|계교|북평|양원|천리석/.test(cityName)) return 'NORTHERN_FRONTIER';
    if (/건업|오|회계|여강|장사|계양|영릉|서창|교지|남해|교주/.test(cityName)) return 'SOUTHERN_JUNGLE';
    if (/하비|서주|패|소패|광릉|회남|수춘|합비|여남|汝/.test(cityName)) return 'RIVERLANDS';
    if (mapX !== undefined && mapY !== undefined) {
        // 지도 좌표 기반: y 상단(북방) 1/3 → 북방, 하단 1/3 → 남방, x 우측(동남) 1/3 → 하류
        if (mapY < 0.34) return 'NORTHERN_FRONTIER';
        if (mapY > 0.72) return 'SOUTHERN_JUNGLE';
        if (mapX > 0.72) return 'RIVERLANDS';
    }
    return 'CENTRAL_PLAINS';
}

export class MonthlyReportSystem {
    constructor(
        private store: GameStore,
        /** 엔진이 수집한 최근 월간 포팅 시스템 요약 peek (없으면 섹션 생략) */
        private portedProvider?: () => PortedMonthlySection | null,
    ) {}

    generate(): MonthlyReport {
        const gs = this.store.getGlobalState();
        const playerFactionId = gs.playerFactionId;
        const playerFaction = playerFactionId ? this.store.getFaction(playerFactionId) : null;
        const playerCities = playerFactionId ? this.store.getCitiesByFaction(playerFactionId) : [];

        return {
            year: gs.time.year,
            month: gs.time.month,
            turnCount: gs.turnCount,
            playerGold: playerFaction?.gold ?? 0,
            playerFood: playerFaction?.food ?? 0,
            goldIncome: playerCities.reduce((s, c) => s + c.goldIncome, 0),
            foodIncome: playerCities.reduce((s, c) => s + c.foodIncome, 0),
            cities: playerCities.map(c => ({
                name: c.name,
                funds: c.funds,
                development: c.development,
                commerce: c.developmentStats.commerce,
                farming: c.developmentStats.farming,
            })),
            factions: this.store.getAllFactions()
                .filter(f => f.id !== playerFactionId)
                .map(f => ({
                    name: f.name,
                    gold: f.gold,
                    cities: this.store.getCitiesByFaction(f.id).length,
                    officers: this.store.getAllOfficers().filter(o => o.factionId === f.id).length,
                })),
            ported: this.portedProvider?.() ?? null,
        };
    }
}
