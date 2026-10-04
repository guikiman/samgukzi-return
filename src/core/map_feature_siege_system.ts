/**
 * 전략 요충지(關·要塞) 점령 — 출진, 포위 진행, 자동 함락.
 *
 * [무엇을 하는가]
 * 세력이 인접 요충지에 병력을 보내 포위를 개시한다. 매달 포위 개월이 1 줄고,
 * 수비 병력이 자연 감소한다. 개월이 0 이 되면 함락되어 소유권이 넘어간다.
 * 수비군이 반격해 병력이 임계 아래로 떨어지면 포위가 파산된다.
 *
 * [왜 순수 로직인가]
 * 스토어·DOM에 의존하지 않는다. 포위 개월과 병력 감소 같은 경계 규칙을 roll 없이
 * 결정적으로 검증할 수 있고, 적용은 엔진이 store 로 한다.
 */

import type { FactionID, CityID, MapFeature, SiegeOperation } from './types.js';

// ============================================================
// 상수
// ============================================================

/** 요충지 종류별 기본 포위 개월 — 실제 역사적 수성과 비슷하게 잡았다. */
export const DEFAULT_SIEGE_MONTHS: Record<MapFeature['kind'], number> = {
    PASS: 3,
    FORTRESS: 4,
    BATTLEFIELD: 2,
    PORT: 2,
};

/**
 * 포위 개월 1개월당 깎이는 수비 병력 비율(0~1).
 *
 * [왜 '매달'가 아니라 '개월당'인가]
 * 처음엔 매달 18% 로 두었는데, 그러면 3000명 수비군이 0 이 되려면 30개월이 걸린다.
 * 포위 기한은 2~4개월이므로 기한이 항상 먼저 와서, 수비군 감소분이 죽은 로직이 된다.
 * 실제로 약한 출진(400명)도 강한 출진(6000명)이나 똑같이 3개월 만에 함락됐다.
 * 개월당 비율로 다시 잡아 기한 안에 수비군이 실질적으로 줄도록 만들었다.
 */
export const GARRISON_ATTRITION_PER_SIEGE_MONTH = 0.5;

/**
 * 출진 병력의 매달 자연 감소 비율(0~1) — 포위 중에는 교전이 없다.
 *
 * [왜 0.15 인가]
 * 0.06 으로 두면 파산 판정이 사실상 도달 불가였다. 300명이 파산되려면 7개월이 걸리는데
 * 가장 긴 포위(요새 4개월)보다 길어서, 약한 출진도 기한 안에 함락되고 말았다.
 * 0.15 로 올리면 300명은 3개월에, 1000명은 10개월에 파산된다. 그래야 "병력이 적으면
 * 포위가 유지된다" 는 규칙이 실제 판정에 영향을 준다.
 */
export const BESIEGER_ATTRITION_RATE = 0.15;

/** 이 병력 아래로 떨어지면 반격에 파산된다. */
export const SIEGE_MIN_TROOPS = 200;

/** 출진 최소 병력 — 이보다 적으면 요충지에 못 닿는다. */
export const SIEGE_MIN_COMMIT_TROOPS = 1000;

// ============================================================
// 개시 가능 판정
// ============================================================

/** 정규화 지도 거리. */
function distance(a: MapFeature, cityMapX: number, cityMapY: number): number {
    return Math.hypot(a.mapX - cityMapX, a.mapY - cityMapY);
}

/** 인접한 아군 요충지가 있는 도시의 포위 수성 연장 개월. */
export const SUPPLY_BONUS_MONTHS = 2;

export interface SiegeEligibility {
    ok: boolean;
    reason: string;
}

/**
 * 이 도시에서 이 요충지를 포위할 수 있는지 판정한다.
 *
 * [왜 도시에서 시작하는가]
 * 플레이어는 도시를 점령한 뒤 인접 요충지를 붙이는 순서로 영토를 넓힌다.
 * 도시에서 멀리 떨어진 요충지까지 한 번에 쏘는 전략을 막아 출발점을 도시로 묶는다.
 */
export function checkSiegeEligibility(
    feature: MapFeature,
    factionId: FactionID,
    opts: { ownerId: FactionID | null; cityMapX: number; cityMapY: number; adjacentDist: number },
): SiegeEligibility {
    if (feature.ownerId === factionId) return { ok: false, reason: '이미 아군 소유다.' };
    if (feature.besiegedByFactionId && feature.besiegedByFactionId !== factionId) {
        return { ok: false, reason: '이미 다른 세력이 포위 중이다.' };
    }
    if (distance(feature, opts.cityMapX, opts.cityMapY) > opts.adjacentDist) {
        return { ok: false, reason: '인접하지 않은 요충지다.' };
    }
    return { ok: true, reason: '' };
}

// ============================================================
// 포위 생성
// ============================================================

/** 이 요충지의 포위가 몇 개월 더 버틸 수 있는가. */
export function siegeDurationFor(feature: MapFeature, hasSupplyFeature: boolean): number {
    return DEFAULT_SIEGE_MONTHS[feature.kind] + (hasSupplyFeature ? SUPPLY_BONUS_MONTHS : 0);
}

export interface SiegeStart {
    operation: SiegeOperation;
    feature: MapFeature;
    message: string;
}

/**
 * 포위를 개시한다.
 *
 * @param troops 출진 병력. 도시 병력을 넘어설 수 없다 — supplyRadius 밖이면 고갈된다.
 */
export function startSiege(
    feature: MapFeature,
    factionId: FactionID,
    originCityId: CityID,
    troops: number,
    turn: number,
    opts: { hasSupplyFeature: boolean; maxTroops?: number },
    id: string,
): SiegeStart {
    const committed = Math.max(0, Math.min(troops, opts.maxTroops ?? troops));
    const durationTurns = siegeDurationFor(feature, opts.hasSupplyFeature);
    return {
        operation: {
            id,
            factionId,
            featureId: feature.id,
            troops: committed,
            startTurn: turn,
            durationTurns,
            status: 'ACTIVE',
        },
        feature: {
            ...feature,
            siegeMonthsRemaining: durationTurns,
            besiegedByFactionId: factionId,
            besiegedCityIds: [originCityId],
        },
        message: `${feature.name} 포위를 개시했다 (목표 ${durationTurns}개월, 출진 ${committed}명).`,
    };
}

// ============================================================
// 월간 포위 진행
// ============================================================

export interface SiegeAdvance {
    operation: SiegeOperation;
    feature: MapFeature;
    status: SiegeOperation['status'];
    message: string;
}

/**
 * 한 회차만큼 포위를 진행한다.
 *
 * [판정 순서]
 * 파산(출진 소멸) → 성공(수비군 소멸) → 기한 만료(자동 함락).
 * 출진 병력이 먼저 사라지면 그 달 수비군을 깎지 않는다.
 */
export function advanceSiege(
    operation: SiegeOperation,
    feature: MapFeature,
    turn: number,
): SiegeAdvance {
    if (operation.status !== 'ACTIVE') {
        return { operation, feature, status: operation.status, message: '' };
    }

    const decayedTroops = Math.max(0, operation.troops - Math.round(operation.troops * BESIEGER_ATTRITION_RATE));
    if (decayedTroops < SIEGE_MIN_TROOPS) {
        return {
            operation: { ...operation, troops: decayedTroops, status: 'BROKEN' },
            feature: {
                ...feature,
                siegeMonthsRemaining: 0,
                besiegedByFactionId: null,
                besiegedCityIds: [],
            },
            status: 'BROKEN',
            message: `포위 병력이 소진되어 ${feature.name} 포위가 풀렸다.`,
        };
    }

    const nextTroops = operation.troops - Math.round(operation.troops * BESIEGER_ATTRITION_RATE);
    const decayedGarrison = Math.max(
        0,
        feature.garrison - Math.round(feature.garrison * GARRISON_ATTRITION_PER_SIEGE_MONTH),
    );
    const monthsRemaining = feature.siegeMonthsRemaining - 1;

    if (decayedGarrison <= 0) {
        return {
            operation: { ...operation, troops: nextTroops, status: 'SUCCEEDED' },
            feature: {
                ...feature,
                garrison: 0,
                ownerId: operation.factionId,
                siegeMonthsRemaining: 0,
                besiegedByFactionId: null,
                besiegedCityIds: [],
            },
            status: 'SUCCEEDED',
            message: `${feature.name} 수비군이 소진되어 점령했다.`,
        };
    }

    if (monthsRemaining <= 0) {
        return {
            operation: { ...operation, troops: nextTroops, status: 'SUCCEEDED' },
            feature: {
                ...feature,
                garrison: decayedGarrison,
                ownerId: operation.factionId,
                siegeMonthsRemaining: 0,
                besiegedByFactionId: null,
                besiegedCityIds: [],
            },
            status: 'SUCCEEDED',
            message: `${feature.name}을 돌격해 점령했다.`,
        };
    }

    return {
        operation: { ...operation, troops: nextTroops, status: 'ACTIVE' },
        feature: {
            ...feature,
            garrison: decayedGarrison,
            siegeMonthsRemaining: monthsRemaining,
        },
        status: 'ACTIVE',
        message: `${feature.name} 포위 ${operation.durationTurns - monthsRemaining}/${operation.durationTurns}개월, 수비군 ${decayedGarrison}명.`,
    };
}
