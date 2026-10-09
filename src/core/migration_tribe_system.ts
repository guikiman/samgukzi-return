/**
 * 이민족(邊境部族) 교섭 시스템 — Migration Tribe Diplomacy
 *
 * [무엇을 하는가]
 * 승강·오랑·匈奴系 부족이 주변 지역에 이주해 머무르면 이벤트가 활성화되고, 플레이어는
 * 그 부족과 교섭해 세 가지를 얻을 수 있다:
 *   1) 군량미(糧) 지원 — 성의 값이 아니라 우호도로 올라오는 지원
 *   2) 병력 지원 — 용병 병력
 *   3) 침략 요구 철회 — 적대 세력/도시가 내세운 침략 요구를 되돌리게 한다
 * 金(斗鐵 도량衡이 아니라 화폐 단위)이나 糧으로 거래하고, 우호도가 오를수록 호가가 내려간다.
 *
 * [왜 DiplomacyEngine 을 쓰지 않는가]
 * DiplomacyEngine 의 관계 키는 FactionID 쌍이고 세력 간 항복/동맹 전용이다
 * (diplomacy_engine.ts:34 `key(a,b)`). 부족은 세력도 노조 소속 무장도 아니므로
 * 그 관계표에 넣을 수 없다. 그래서 우호도는 부족 쪽 상태로 따로 둔다.
 *
 * [순수 로직]
 * 이 모듈은 DOM·캔버스·스토어에 의존하지 않는다. 금액/확률을 순수 함수로 계산하고,
 * 상태 변경은 호출부가 스토어에 반영한다. 덕분에 교환 곡선 같은 사양을 브라우저 없이
 * 검증할 수 있다.
 */

import type { CityID, FactionID, TribeSettlement, TribeState, InvasionDemand } from './types.js';

// 상태 타입(TribeState/InvasionDemand/TribeSettlement)은 types.ts 가 단일 원자로 둔다.
// 여기서 다시 선언하면 정규화 상태에 들어가는 타입과 시스템이 계산하는 타입이 갈라진다.
export type { TribeSettlement, TribeState, InvasionDemand };

// ============================================================
// 교섭 상수
// ============================================================

/** 우호도 하한/상한. 이 범위로 정규화한다. */
export const AFFINITY_MIN = -100;
export const AFFINITY_MAX = 100;

/**
 * 우호도가 AFFINITY_MIN 일 때의 糧 단위당 가격(1 糧 몇 金). 우호도가 오를수록 내려간다.
 *
 * [수치를 게임 경제에서 역산했다]
 * 도시 1곳이 한 달에 175金 / 460粮 을 번다(시나리오 05 도시 프로필 평균).
 * 200粮 지원 1회가 최저 우호도에서 240金 — 도시 1.4개월 치 수입이다.
 * 값어치를 느끼면서도 파산시키지 않는 선이다. 10金/粮 으로 두면 지원 1회에
 * 도시 국고의 절반이 나가 거래가 선택지로서 성립하지 않는다.
 */
export const BASE_GRAIN_PRICE_PER_GRAIN = 1.2;

/** 최고 우호도에서도 내려가는 할인율의 한계(0~1). 0.35 = 35% 까지 깎아준다. */
export const MAX_AFFINITY_DISCOUNT = 0.35;

/** 금으로 糧을 살 때의 우호도 할인. */
export const GOLD_TO_GRAIN_DISCOUNT = 1.0;
/** 糧으로 金を 살 때의 우호도 할인. */
export const GRAIN_TO_GOLD_DISCOUNT = 0.6;

/** 교섭 1회에 우호도가 오르는 양(성공 시). */
export const AFFINITY_GAIN_PER_NEGOTIATION = 12;

/** 지원 확률의 floors/ceilings. */
export const AID_SUCCESS_FLOOR = 0.15;
export const AID_SUCCESS_CEILING = 0.9;

/** 침략 요구 철회 성공 확률 상한.要求和 연관이 약하면 即시 우호도가 높아도 어렵다. */
export const RETRACT_SUCCESS_CEILING = 0.85;

// ============================================================
// 순수 계산 함수
// ============================================================

function clamp(value: number, lo: number, hi: number): number {
    return value < lo ? lo : value > hi ? hi : value;
}

/** 우호도를 [0,1] 정규화. 0 = 최악, 1 = 최선. */
export function normalizeAffinity(affinity: number): number {
    return clamp((affinity - AFFINITY_MIN) / (AFFINITY_MAX - AFFINITY_MIN), 0, 1);
}

/** 우호도에서 할인율을 뽑는다. 0.35 를 넘지 않는다. */
export function affinityDiscount(affinity: number, maxDiscount = MAX_AFFINITY_DISCOUNT): number {
    return normalizeAffinity(affinity) * maxDiscount;
}

/**
 * 1 糧 당 가격(金). 우호도가 높을수록 내려간다.
 *
 * [왜 정수가 아니라 소수를 돌려주는가]
 * 1 糧 단위로 사면 금이 동전 단위로 잘려不出去한다. 거래는 묶음 단위로 하고
 * 총액을 한 번에 반올림하는 쪽이 매력적이다(quantizeTrade).
 */
export function grainPricePerUnit(affinity: number, maxDiscount = MAX_AFFINITY_DISCOUNT): number {
    return BASE_GRAIN_PRICE_PER_GRAIN * (1 - affinityDiscount(affinity, maxDiscount));
}

/** 금 → 糧 거래 총액. grainQuantity 만큼의 糧을 사는데 필요한 金. */
export function quoteGrainForGold(
    grainQuantity: number,
    affinity: number,
    maxDiscount = MAX_AFFINITY_DISCOUNT,
): number {
    return Math.ceil(grainPricePerUnit(affinity, maxDiscount) * grainQuantity);
}

/**
 * 糧 → 금 거래 총액. 이민족에게 糧을 주고 金을 산다.
 * 역방향이라 우호도가 올라가면 "가는 쪽"의 환율이 나빠지므로 할인을 키운다.
 */
export function quoteGoldForGrain(
    grainQuantity: number,
    affinity: number,
    maxDiscount = MAX_AFFINITY_DISCOUNT,
): number {
    const discount = affinityDiscount(affinity, maxDiscount * GRAIN_TO_GOLD_DISCOUNT);
    return Math.ceil(grainQuantity * (BASE_GRAIN_PRICE_PER_GRAIN * 0.6) * (1 - discount));
}

/** 호가 모순 확인 — 우호도가 높을수록 糧 단가가 반드시 내려간다. */
export function isPriceMonotonic(affinity: number): boolean {
    return grainPricePerUnit(affinity + 10) <= grainPricePerUnit(affinity);
}

/**
 * 지원 성공 확률. 우호도가 지배한다.
 *
 * [왜 확률인가]
 * 교섭은 협상이다. 100 으로 고정하면 플레이어에게 선택지가 없고, 우호도가 무의미해진다.
 * 그래서 성공/실패의 불확실성을 남겨 두되, 바닥/천장을 둔다.
 */
export function aidSuccessChance(affinity: number): number {
    const base = 0.15 + normalizeAffinity(affinity) * 0.7;
    return clamp(base, AID_SUCCESS_FLOOR, AID_SUCCESS_CEILING);
}

/**
 * 침략 요구 철회 성공 확률.
 *
 * [왜 요구의 크기를penalty로 주는가]
 * 세력 전체 요구(도시 1곳 요구보다 무거움)는 아무리 친밀해도 완전히 거절당할 수 있다.
 * 요구의 무게가 클수록 확률을 깎아, "다 쓴 티empt" 요구에 항상 성공하게 되는 것을 막는다.
 */
export function retractSuccessChance(affinity: number, demandWeight: number): number {
    const base = 0.1 + normalizeAffinity(affinity) * 0.8;
    const weightPenalty = clamp(demandWeight, 0, 1) * 0.45;
    return clamp(base - weightPenalty, 0, RETRACT_SUCCESS_CEILING);
}

/** 요구의 무게 — 세력 전체 요구가 도시 1곳 요구보다 크다. */
export function demandWeight(demand: InvasionDemand): number {
    return demand.targetsWholeFaction ? 1 : 0.45;
}

/** 거래를 묶음 단위로 떨어지게 한다(소수 金 지불 방지). */
export function quantizeTrade(amount: number): number {
    return Math.max(0, Math.floor(amount));
}

// ============================================================
// 상태 전이 — 호출부가 스토어에 반영할 결과를 돌려준다
// ============================================================

export interface TradeResult {
    success: boolean;
    message: string;
    /** 실제로 지불한 金 (금 → 糧) 또는 얻은 金 (糧 → 금) */
    goldSpent: number;
    /** 실제로 옮긴 糧 */
    grainMoved: number;
    newAffinity: number;
}

/** 부족이 그 도시에 있는가. */
export function isTribeAtCity(tribe: TribeState, cityId: CityID): boolean {
    return tribe.settlement.kind === 'CITY' && tribe.settlement.cityId === cityId;
}

/** 도시 근처(이웃 도시 포함)에 있는가 — '주변 지역' 조건. */
export function isTribeNearCity(tribe: TribeState, cityId: CityID, neighborIds: readonly CityID[]): boolean {
    if (isTribeAtCity(tribe, cityId)) return true;
    if (tribe.settlement.kind === 'CITY' && neighborIds.includes(tribe.settlement.cityId)) return true;
    return false;
}

/** 그 도시에서 교섭 가능한 부족들. */
export function tribesNearCity(
    tribes: readonly TribeState[],
    cityId: CityID,
    neighborIds: readonly CityID[] = [],
): TribeState[] {
    return tribes.filter(t => isTribeNearCity(t, cityId, neighborIds));
}

export interface NegotiationContext {
    /** 호출부 스냅샷 — 순수 계산을 위해 값으로 받는다. */
    playerGold: number;
    playerFood: number;
    tribe: TribeState;
}

/** 금으로 糧을 산다. */
export function tradeGrainForGold(ctx: NegotiationContext, grainQuantity: number): TradeResult {
    const { tribe } = ctx;
    if (grainQuantity <= 0) {
        return { success: false, message: '거래량은 1 이상이어야 합니다.', goldSpent: 0, grainMoved: 0, newAffinity: tribe.affinity };
    }
    const cost = quantizeTrade(quoteGrainForGold(grainQuantity, tribe.affinity));
    if (ctx.playerGold < cost) {
        return {
            success: false,
            message: `资金이 부족합니다 (필요 ${cost}金, 보유 ${ctx.playerGold}金).`,
            goldSpent: 0, grainMoved: 0, newAffinity: tribe.affinity,
        };
    }
    if (tribe.grainStock < grainQuantity) {
        return {
            success: false,
            message: `${tribe.name}의 糧이 모자랍니다 (보유 ${tribe.grainStock}糧).`,
            goldSpent: 0, grainMoved: 0, newAffinity: tribe.affinity,
        };
    }
    const newAffinity = clamp(tribe.affinity + AFFINITY_GAIN_PER_NEGOTIATION, AFFINITY_MIN, AFFINITY_MAX);
    return {
        success: true,
        message: `${grainQuantity}糧을 샀습니다 (${cost}金). 우호도 ${tribe.affinity} → ${newAffinity}.`,
        goldSpent: cost,
        grainMoved: grainQuantity,
        newAffinity,
    };
}

/** 糧을 주고 金을 산다. */
export function tradeGoldForGrain(ctx: NegotiationContext, grainQuantity: number): TradeResult {
    const { tribe } = ctx;
    if (grainQuantity <= 0) {
        return { success: false, message: '거래량은 1 이상이어야 합니다.', goldSpent: 0, grainMoved: 0, newAffinity: tribe.affinity };
    }
    if (ctx.playerFood < grainQuantity) {
        return {
            success: false,
            message: `糧이 부족합니다 (필요 ${grainQuantity}糧, 보유 ${ctx.playerFood}糧).`,
            goldSpent: 0, grainMoved: 0, newAffinity: tribe.affinity,
        };
    }
    const gain = quantizeTrade(quoteGoldForGrain(grainQuantity, tribe.affinity));
    if (gain <= 0) {
        return {
            success: false,
            message: '거래량�� 너무 작아 金을 받을 수 없습니다.',
            goldSpent: 0, grainMoved: 0, newAffinity: tribe.affinity,
        };
    }
    const newAffinity = clamp(tribe.affinity + AFFINITY_GAIN_PER_NEGOTIATION, AFFINITY_MIN, AFFINITY_MAX);
    return {
        success: true,
        message: `${grainQuantity}糧을 주고 ${gain}金을 받았습니다. 우호도 ${tribe.affinity} → ${newAffinity}.`,
        goldSpent: grainQuantity,
        grainMoved: gain,
        newAffinity,
    };
}

export interface AidResult {
    success: boolean;
    message: string;
    /** 지원받은 병력 (병력 지원일 때) */
    soldiers: number;
    /** 지원받은 糧 (군량미 지원일 때) */
    grain: number;
    newAffinity: number;
}

/** 무작위 판정 주입 — 테스트에서 결정적으로 만들 수 있게 한다. */
export type Roll = () => number;

/** 군량미를 지원받는다. */
export function requestGrainAid(tribe: TribeState, roll: Roll = Math.random): AidResult {
    const chance = aidSuccessChance(tribe.affinity);
    const newAffinity = clamp(tribe.affinity + AFFINITY_GAIN_PER_NEGOTIATION, AFFINITY_MIN, AFFINITY_MAX);
    if (roll() > chance) {
        return { success: false, message: `${tribe.name}이(가) 糧 지원을 거절했습니다.`, soldiers: 0, grain: 0, newAffinity };
    }
    const grain = Math.min(200, Math.max(0, tribe.grainStock));
    return {
        success: true,
        message: `${tribe.name}이(가) 糧 ${grain}을 지원했습니다. 우호도 ${tribe.affinity} → ${newAffinity}.`,
        soldiers: 0, grain, newAffinity,
    };
}

/** 병력을 지원받는다(용병). */
export function requestTroopAid(tribe: TribeState, roll: Roll = Math.random): AidResult {
    const chance = aidSuccessChance(tribe.affinity);
    const newAffinity = clamp(tribe.affinity + AFFINITY_GAIN_PER_NEGOTIATION, AFFINITY_MIN, AFFINITY_MAX);
    if (roll() > chance) {
        return { success: false, message: `${tribe.name}이(가) 병력 지원을 거절했습니다.`, soldiers: 0, grain: 0, newAffinity };
    }
    const soldiers = Math.min(500, Math.max(0, tribe.troopStock));
    return {
        success: true,
        message: `${tribe.name}이(가) 병력 ${soldiers}을 지원했습니다. 우호도 ${tribe.affinity} → ${newAffinity}.`,
        soldiers, grain: 0, newAffinity,
    };
}

export interface TroopPayout {
    granted: number;
    capped: boolean;
}

/**
 * 지원받은 병력을 도시 병력에 더하되 수용 한도를 넘기지 않게 한다.
 *
 * [왜 순수 함수로 분리했는가]
 * 한도를 넘는 지원에서 부족 병력만 줄고 도시 병력은 안 늘어나는 손해를 막아야 하는데,
 * 이 규칙이 UI 안에 인라인이면 테스트가 닿지 않는다. 한도를 넘는 지원은
 * 실제로 지급된 분량만 부족 재고에서도 차감해야 하므로 granted 를 함께 돌려준다.
 */
export function troopAidPayout(
    soldiers: number,
    currentTroops: number,
    cap: number,
): TroopPayout {
    const room = Math.max(0, cap - currentTroops);
    const granted = Math.min(Math.max(0, soldiers), room);
    return { granted, capped: granted < Math.max(0, soldiers) };
}

export interface RetractionResult {
    success: boolean;
    message: string;
    withdrawnDemandId: string | null;
    newAffinity: number;
}

/**
 * 침략 요구를 새로 세운다.
 *
 * [왜 순수 함수인가]
 * 요구 생성 규칙(기한·대상)이 UI 에 박히면 테스트가 닿지 않는다.
 * 세력만 주면 나머지는 여기서 정한다.
 */
export function createInvasionDemand(
    issuerFactionId: FactionID,
    targetCityId: CityID,
    opts: { monthsRemaining?: number; targetsWholeFaction?: boolean } = {},
): InvasionDemand {
    return {
        id: `demand_${issuerFactionId}_${targetCityId}_${Date.now()}`,
        issuerFactionId,
        targetCityId,
        targetsWholeFaction: opts.targetsWholeFaction ?? false,
        monthsRemaining: opts.monthsRemaining ?? 3,
        withdrawn: false,
    };
}

/** 아직 철회되지 않았고 기한이 남은 요구 — 실제로 철회 협상의 대상이 된다. */
export function activeDemands(demands: readonly InvasionDemand[]): InvasionDemand[] {
    return demands.filter(d => !d.withdrawn && d.monthsRemaining > 0);
}

/**
 * 침략 요구 철회를 요구한다.
 *
 * [설계 메모]
 * 세 가지 경우를 나눈다:
 *   - 교섭 대상이 아님      → 거절(우호도 변화 없음)
 *   - 확률 판정 실패        → 거절(우호도 소폭 하락)
 *   - 성공                 → 요구 철회 + 우호도 상승
 * 성공 시 돌려주는 demandId 를 호출부가 해당 요구에 적용한다.
 */
export function demandRetraction(
    tribe: TribeState,
    demand: InvasionDemand,
    roll: Roll = Math.random,
): RetractionResult {
    const backed = tribe.backingDemandIds.includes(demand.id);
    if (!backed) {
        return {
            success: false,
            message: `${tribe.name}은(는) 이 요구에 영향력이 없습니다.`,
            withdrawnDemandId: null,
            newAffinity: tribe.affinity,
        };
    }
    if (demand.withdrawn || demand.monthsRemaining <= 0) {
        return {
            success: false,
            message: '이미 철회된 요구입니다.',
            withdrawnDemandId: null,
            newAffinity: tribe.affinity,
        };
    }
    const chance = retractSuccessChance(tribe.affinity, demandWeight(demand));
    if (roll() > chance) {
        const newAffinity = clamp(tribe.affinity - 5, AFFINITY_MIN, AFFINITY_MAX);
        return {
            success: false,
            message: `${tribe.name}이(가) 철회를 거절했습니다. 우호도 ${tribe.affinity} → ${newAffinity}.`,
            withdrawnDemandId: null, newAffinity,
        };
    }
    const newAffinity = clamp(tribe.affinity + AFFINITY_GAIN_PER_NEGOTIATION, AFFINITY_MIN, AFFINITY_MAX);
    return {
        success: true,
        message: `${tribe.name}이(가) 침략 요구를 철회했습니다. 우호도 ${tribe.affinity} → ${newAffinity}.`,
        withdrawnDemandId: demand.id,
        newAffinity,
    };
}

// ============================================================
// 이주/사라짐
// ============================================================

/**
 * 이민족이 떠나는지 판정.
 *
 * [왜 확률인가]
 * 이주가 순수 결정적이면 플레이어가 결과를 예측해 계획을 세울 수 없다. 반면 매달
 * 반드시 떠나면 교섭할 기회를 잃어 시스템이 죽는다. 확률을 두어 긴 여운을 만든다.
 */
export function shouldDepart(tribe: TribeState, roll: Roll = Math.random): boolean {
    // 우호도가 높을수록 오래 머문다.
    const departChance = 0.35 - normalizeAffinity(tribe.affinity) * 0.25;
    return roll() < departChance;
}

// ============================================================
// 초기 이주 배치
// ============================================================

/** 부족 배치 명단 — 실제 존재하는 도시명(한자음)으로 적는다. */
export interface TribePlacementSpec {
    id: string;
    name: string;
    /** 이 부족이 처음 머무르는 도시명. 월드에 없으면 조용히 건너뛴다. */
    cityName: string;
    strength: number;
    affinity: number;
    grainStock: number;
    troopStock: number;
}

/**
 * 초기 배치 — 북방 접경지에 실제로 실존하던 부족을 둔다.
 *
 * [왜 도시명으로 적고 id 로 저장하는가]
 * 월드에 없는 도시를 지정하면 조용히 누락된다(아래 주석). 그래서 '이름 → id' 해석을
 * 한 곳에 두고, 해석 실패는 조용히 넘기지 않고 개수를 함께 돌려준다.
 */
export const DEFAULT_TRIBE_PLACEMENTS: TribePlacementSpec[] = [
    { id: 'tribe_xiongnu', name: '匈奴', cityName: '상용', strength: 4200, affinity: -20, grainStock: 600, troopStock: 900 },
    { id: 'tribe_wuhuan', name: '烏桓', cityName: '진양', strength: 2600, affinity: 0, grainStock: 400, troopStock: 500 },
    { id: 'tribe_xianbei', name: '鮮卑', cityName: '무창', strength: 3100, affinity: -10, grainStock: 500, troopStock: 650 },
    { id: 'tribe_diang', name: '氐', cityName: '교지', strength: 1800, affinity: 10, grainStock: 350, troopStock: 300 },
];

// 월간 부족 affairs — 교섭 잠금 해제 + 이탈
// ====================================

/** 이탈 시 우호도 하락 — 떠나간 부족을 다시 받아들이기 어렵게 만든다. */
export const DEPART_AFFINITY_PENALTY = 15;

export const FRONTIER_REGION = '변방';

export interface TribeMonthlyUpdate {
    id: string;
    negotiatedThisMonth: false;
    affinity: number;
    settlement: TribeSettlement;
    departed: boolean;
    message: string | null;
}

/**
 * 월간 부족 affairs 를 순수하게 계산한다.
 *
 * [왜 스토어에 직접 쓰지 않는가]
 * '구한 것'만 돌려주고 엔진이 store.updateMigrationTribe 로 원자 반영한다. 그래야
 * 확률 판정이 테스트에서 결정적이고, 스토어 쓰기 실패 시 중간 상태가 안 남는다.
 */
export function planMonthlyTribeAffairs(
    tribes: readonly TribeState[],
    demands: readonly InvasionDemand[],
    roll: Roll = Math.random,
): TribeMonthlyUpdate[] {
    return tribes.map(t => {
        // 교섭 잠금은 무조건 해제한다 — 이게 없으면 도시를 다시 방문해도
        // 평생 "이미 교섭했다" 로 창이 안 열린다.
        const leaving = shouldDepart(t, roll);
        const affinity = leaving
            ? clamp(t.affinity - DEPART_AFFINITY_PENALTY, AFFINITY_MIN, AFFINITY_MAX)
            : t.affinity;
        return {
            id: t.id,
            negotiatedThisMonth: false as const,
            affinity,
            settlement: leaving ? { kind: 'REGION' as const, region: FRONTIER_REGION } : t.settlement,
            departed: leaving,
            message: leaving
                ? `${t.name}이(가) 떠났다. 우호도 ${t.affinity} → ${affinity}.`
                : null,
        };
    });
}

export function demandsAbandonedBy(
    update: TribeMonthlyUpdate,
    tribe: TribeState,
    demands: readonly InvasionDemand[],
): string[] {
    if (!update.departed) return [];
    const backing = new Set(tribe.backingDemandIds);
    return demands.filter(d => backing.has(d.id) && !d.withdrawn).map(d => d.id);
}

/**
 * 배치 명단을 실제 도시 id 로 옮긴다.
 *
 * @param nameToId 도시명 → 도시 id. 미등록 도시는 조용히 건너뛴다.
 * @returns 배치된 부족 목록
 */
export function buildTribeRoster(
    nameToId: Readonly<Record<string, string>>,
    placements: readonly TribePlacementSpec[] = DEFAULT_TRIBE_PLACEMENTS,
): TribeState[] {
    const out: TribeState[] = [];
    for (const p of placements) {
        const cityId = nameToId[p.cityName];
        // 월드에 없는 도시면 배치하지 않는다 — 없는 도시 id 를 store 에 넣으면
        // getTribesByCity 가 영영 못 찾는 고아 인덱스가 된다.
        if (!cityId) continue;
        out.push({
            id: p.id,
            name: p.name,
            settlement: { kind: 'CITY', cityId },
            strength: p.strength,
            affinity: p.affinity,
            grainStock: p.grainStock,
            troopStock: p.troopStock,
            backingDemandIds: [],
            negotiatedThisMonth: false,
        });
    }
    return out;
}
