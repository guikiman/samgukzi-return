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
    cities: Array<{
        name: string;
        funds: number;
        development: number;
        commerce: number;
        farming: number;
    }>;
    /** AI 세력 요약 */
    factions: Array<{
        name: string;
        gold: number;
        cities: number;
        officers: number;
    }>;
    /** 포팅 시스템 월간 동향 — 엔진의 processPortedSystemsMonthly가 수집 [76-85][321-340][341-360][421-438] */
    ported?: PortedMonthlySection | null;
}
export interface PortedMonthlySection {
    /** 이번 달 완료된 출진 명령 [77] */
    campaigns: Array<{
        targetCity: string;
        leaderName: string;
        soldiers: number;
    }>;
    /** 이번 달 완료된 수송 명령 [78] */
    transports: Array<{
        fromCity: string;
        toCity: string;
        gold: number;
        food: number;
        soldiers: number;
    }>;
    /** 붕괴한 첩보망 — 유지비 미납 [346] */
    collapsedNetworks: Array<{
        factionId: string;
        cityId: string;
    }>;
    /** 지역 기후 현황 [321-340] */
    climates: Array<{
        regionId: string;
        weather: string;
        temperature: number;
        harvestModifier: number;
    }>;
    /** 이번 달 은퇴한 무장 [434] */
    retired: Array<{
        officerName: string;
        age: number;
    }>;
    /** 전투 후 포로 처분 결과 [121-130][131-145] */
    captives: Array<{
        officerId: string;
        officerName: string;
        decision: 'RECRUIT' | 'EXECUTE' | 'RELEASE';
        success: boolean;
        message: string;
    }>;
    /** [83] 방랑군 동향 — 전환/등용/습격/재기 */
    vagrant: Array<{
        factionName: string;
        kind: 'CONVERT' | 'RECRUIT' | 'RAID';
        success: boolean;
        message: string;
    }>;
    /** 도시별 기후 표 [321-340] — 소유 세력 포함. climates가 비어도 도시 행은 표시 */
    cityClimates: Array<{
        cityName: string;
        regionId: string;
        weather: string;
        temperature: number;
        harvestModifier: number;
        ownerId: string | null;
    }>;
}
/**
 * 도시 → 기후 지역 매핑 [321-340]
 * 거점의 지리적 위치(위도/강수)에 따라 4개 기후권으로 배정.
 * 도시명에 지역 키워드가 포함되면 해당 기후권, 그 외에는 지도 좌표로 결정.
 */
export declare function resolveCityClimateRegion(cityName: string, mapX?: number, mapY?: number): string;
export declare class MonthlyReportSystem {
    private store;
    /** 엔진이 수집한 최근 월간 포팅 시스템 요약 peek (없으면 섹션 생략) */
    private portedProvider?;
    constructor(store: GameStore, 
    /** 엔진이 수집한 최근 월간 포팅 시스템 요약 peek (없으면 섹션 생략) */
    portedProvider?: (() => PortedMonthlySection | null) | undefined);
    generate(): MonthlyReport;
}
//# sourceMappingURL=monthly_report.d.ts.map