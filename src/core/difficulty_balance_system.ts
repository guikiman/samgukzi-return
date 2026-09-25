/**
 * 난이도 밸런싱 시스템 [X-난이도][E-도시내정]
 *
 * 시나리오 난이도(1~5)에 따라 로밍/방문 이벤트의 빈도와 효과를 조절한다:
 *  - 낮은 난이도: 이벤트 자주 발생 + 효과 큼 (초보자 지원)
 *  - 높은 난이도: 이벤트 드물게 + 산적 피해는 커짐 (생존 압박)
 *
 * 스토어 GlobalState.difficulty에서 읽어 배율만 제공하므로
 * 기존 판정 로직을 침범하지 않고 시스템 간 공유된다.
 */

import type { GameStore } from './game_store.js';

/** 난이도 배율표 — 인덱스 = difficulty - 1 (1~5) */
export interface DifficultyMultiplier {
    /** 로밍 이벤트 빈도 배율 (matcher 확률에 곱연산 대상은 아님 — 샘플 도시 수에 적용) */
    roamingFrequency: number;
    /** 재야 무장 방문 빈도 배율 */
    visitFrequency: number;
    /** 플레이어 수혜 효과 배율 (선양/교역/기술 등) */
    benefitScale: number;
    /** 산적 약탈 피해 배율 */
    banditScale: number;
}

/** 난이도 1(쉬움)~5(지옥) 배율표 */
export const DIFFICULTY_MULTIPLIERS: DifficultyMultiplier[] = [
    /* 1 쉬움   */ { roamingFrequency: 1.6, visitFrequency: 1.5, benefitScale: 1.3, banditScale: 0.5 },
    /* 2 보통   */ { roamingFrequency: 1.3, visitFrequency: 1.2, benefitScale: 1.15, banditScale: 0.8 },
    /* 3 표준   */ { roamingFrequency: 1.0, visitFrequency: 1.0, benefitScale: 1.0, banditScale: 1.0 },
    /* 4 어려움 */ { roamingFrequency: 0.8, visitFrequency: 0.8, benefitScale: 0.85, banditScale: 1.4 },
    /* 5 지옥   */ { roamingFrequency: 0.6, visitFrequency: 0.6, benefitScale: 0.7, banditScale: 2.0 },
];

/** 기본 난이도 (미지정 시 — 표준) */
export const DEFAULT_DIFFICULTY = 3;

/** 신규 게임 초기 12개월에 적용되는 AI 난이도 상승 곡선 [X-난이도][201]
 * 각 값은 1개월(0~11개월차)부터 12개월까지의 목표 난이도 도달 비율이다.
 * 0은 쉬움, 1은 시나리오 목표 난이도이며 중간 값은 완만한 상승이다.
 * 테스트/콘텐츠 설정에서 배열을 교체할 수 있도록 readonly 상수로 노출한다.
 */
export const AI_DIFFICULTY_CURVE: readonly number[] = [
    0, 0.08, 0.16, 0.24, 0.32, 0.40, 0.48, 0.56, 0.64, 0.72, 0.86, 1,
];

export interface AIDifficultyCurveConfig {
    /** 1~12개월에 대응하는 목표 난이도 도달 비율. 길이 1~12 허용. */
    readonly values: readonly number[];
}

/** 기본 초기 12개월 난이도 곡선 설정 */
export const DEFAULT_AI_DIFFICULTY_CURVE_CONFIG: AIDifficultyCurveConfig = {
    values: AI_DIFFICULTY_CURVE,
};

function clampDifficulty(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_DIFFICULTY;
    return Math.min(5, Math.max(1, Math.round(value)));
}

function normalizeCurve(config?: AIDifficultyCurveConfig): readonly number[] {
    const values = config?.values?.length ? config.values : AI_DIFFICULTY_CURVE;
    return values.map(value => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
}

/**
 * 신규 게임의 turnCount(0=첫 달)로부터 초기 12개월 AI 난이도를 계산한다.
 * 12개월 이후에는 시나리오 난이도를 유지하고 잘못된 입력은 안전한 경계로 보정한다.
 */
export function resolveAIMonthlyDifficulty(
    targetDifficulty: number,
    turnCount: number,
    config: AIDifficultyCurveConfig = DEFAULT_AI_DIFFICULTY_CURVE_CONFIG,
): number {
    const target = clampDifficulty(targetDifficulty);
    const curve = normalizeCurve(config);
    const monthIndex = Math.min(curve.length - 1, Math.max(0, Math.floor(Number.isFinite(turnCount) ? turnCount : 0)));
    const progress = curve[monthIndex];
    return 1 + (target - 1) * progress;
}

/** 스토어의 시나리오 난이도와 현재 턴을 사용해 유효 AI 난이도를 조회한다. */
export function getAIMonthlyDifficulty(
    store: GameStore,
    config: AIDifficultyCurveConfig = DEFAULT_AI_DIFFICULTY_CURVE_CONFIG,
): number {
    const gs = store.getGlobalState();
    return resolveAIMonthlyDifficulty(getDifficulty(store), gs.turnCount, config);
}

/** 기존 AI 행동 가중치에 곱할 배율. 표준 난이도·12개월 이후에는 1.0이다. */
export function getAIMonthlyDifficultyMultiplier(
    store: GameStore,
    config: AIDifficultyCurveConfig = DEFAULT_AI_DIFFICULTY_CURVE_CONFIG,
): number {
    return getAIMonthlyDifficulty(store, config) / DEFAULT_DIFFICULTY;
}

/** 스토어에서 유효 난이도를 읽는다 (1~5 클램프, 구버전 세이브 undefined 허용) */
export function getDifficulty(store: GameStore): number {
    const d = store.getGlobalState().difficulty;
    if (typeof d !== 'number' || Number.isNaN(d)) return DEFAULT_DIFFICULTY;
    return Math.min(5, Math.max(1, Math.round(d)));
}

/** 스토어에서 난이도 배율을 조회한다 */
export function getDifficultyMultiplier(store: GameStore): DifficultyMultiplier {
    return DIFFICULTY_MULTIPLIERS[getDifficulty(store) - 1];
}

/** 난이도 반영 방문 확률 — 기본 확률에 빈도 배율을 곱하고 1로 클램프 */
export function scaleVisitChance(baseChance: number, store: GameStore): number {
    return Math.min(1, baseChance * getDifficultyMultiplier(store).visitFrequency);
}

/** 난이도 반영 로밍 샘플 도시 수 — 기본 수에 빈도 배율을 곱하고 [1, 전체]로 클램프 */
export function scaleRoamingCityCount(baseCount: number, totalCities: number, store: GameStore): number {
    const scaled = Math.round(baseCount * getDifficultyMultiplier(store).roamingFrequency);
    return Math.min(totalCities, Math.max(1, scaled));
}
