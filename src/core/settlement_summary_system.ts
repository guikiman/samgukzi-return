/**
 * 월말 정산 요약 [E1-361][461-480]
 *
 * 턴 종료 시점의 세력 경제·인구 스냅샷을 산출해 UI 요약 패널에 제공한다:
 *  - 수입: 도시 goldIncome/foodIncome 합계
 *  - 보유: 국고/병량 현재값
 *  - 병력/무장: 전투 가능 병력과 무장 수
 *
 * 이전 턴 스냅샷과 비교해 증감(Δ)을 계산하는 것은 UI 계층에서 수행하며,
 * 이 모듈은 순수 스냅샷 산출만 담당한다(테스트 용이성).
 */

import type { GameStore } from './game_store.js';

/** 세력별 정산 스냅샷 */
export interface FactionSettlement {
    factionId: string;
    factionName: string;
    /** 도시 수 */
    cityCount: number;
    /** 월 금 수입 합계 */
    goldIncome: number;
    /** 월 병량 수입 합계 */
    foodIncome: number;
    /** 현재 국고 */
    gold: number;
    /** 현재 병량 */
    food: number;
    /** 총 병력 (전투 가능 기준) */
    troops: number;
    /** 소속 무장 수 */
    officerCount: number;
    /** 평균 사기 (0~100) */
    avgMorale: number;
}

/** 월말 정산 리포트 */
export interface SettlementReport {
    year: number;
    month: number;
    turn: number;
    factions: FactionSettlement[];
}

/**
 * 월말 정산 스냅샷을 산출한다. 엔진 턴 종료 시(advanceTime 직후) 호출을 권장 —
 * advanceTime 전이면 수입 반영 전 값이 나온다.
 */
export function computeSettlement(store: GameStore): SettlementReport {
    const gs = store.getGlobalState();
    const factions = store.getAllFactions().map(faction => {
        const cities = store.getCitiesByFaction(faction.id);
        const goldIncome = cities.reduce((s, c) => s + c.goldIncome, 0);
        const foodIncome = cities.reduce((s, c) => s + c.foodIncome, 0);

        const officers = store.getOfficersByFaction(faction.id);
        // 병력·사기는 군단(Army) 기준 — 정규전 병력은 유닛이 아니라 군단이 보유
        let troops = 0;
        let moraleSum = 0;
        let armyCount = 0;
        for (const armyId of faction.armies) {
            const army = store.getArmy(armyId);
            if (!army) continue;
            troops += army.soldiers;
            moraleSum += army.morale;
            armyCount++;
        }
        const avgMorale = armyCount > 0 ? Math.round(moraleSum / armyCount) : 0;

        return {
            factionId: faction.id,
            factionName: faction.name,
            cityCount: cities.length,
            goldIncome,
            foodIncome,
            gold: faction.gold,
            food: faction.food,
            troops,
            officerCount: officers.length,
            avgMorale,
        };
    });

    return {
        year: gs.time.year,
        month: gs.time.month,
        turn: gs.turnCount,
        factions,
    };
}

/** 스냅샷 간 Δ (현재 − 이전) — UI 증감 표시용 */
export interface SettlementDelta {
    gold: number;
    food: number;
    troops: number;
    officerCount: number;
}

export function diffSettlement(
    prev: FactionSettlement | undefined,
    curr: FactionSettlement,
): SettlementDelta {
    if (!prev) {
        return { gold: 0, food: 0, troops: 0, officerCount: 0 };
    }
    return {
        gold: curr.gold - prev.gold,
        food: curr.food - prev.food,
        troops: curr.troops - prev.troops,
        officerCount: curr.officerCount - prev.officerCount,
    };
}
