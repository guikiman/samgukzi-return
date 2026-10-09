/**
 * 이동 수송 방식과 소요 시간 — 육로는 말, 바다는 배 [2026-10-04]
 * 파일: src/core/travel_transport.ts
 *
 * [무엇을 계산하는가]
 * 도시 사이 이동 경로를 지형에 따라 **구간으로 분해**하고, 각 구간이 어떤
 * 수송(말/배)을 쓰는지와 얼마나 걸리는지 계산한다.
 *
 * [왜 순수 함수인가]
 * 이 계산은 캔버스·DOM·엔진 상태에 의존하지 않는다. 그래야 (1) 테스트에서
 * 지형 없이도 규칙을 검증할 수 있고, (2) 3단계에서 군단 AI 가 같은 계산을
 * 재사용할 수 있다. 지형 판정(`isLand`)만 콜백으로 주입받는다.
 */

/** 수송 방식. */
export type TransportMode = 'HORSE' | 'BOAT';

/** 지형 판정 콜백 — 정규화 좌표(0~1) → 육지인가. */
export type LandProbe = (x: number, y: number) => boolean;

/** 한 구간의 소요 시간 — 게임 1턴 = 1개월 이므로 단위는 **개월** 이다. */
export interface TravelLeg {
    mode: TransportMode;
    ax: number; ay: number;
    bx: number; by: number;
    /** 구간 거리 (정규화 좌표 단위) */
    distance: number;
    /** 소요 개월 수. 1턴 = 1개월 이므로 이 값이 곧 턴 수다. */
    months: number;
}

/** 이동 전체 계획. */
export interface TravelPlan {
    legs: TravelLeg[];
    totalMonths: number;
    totalDistance: number;
    legCount: number;
}

/**
 * 말의 **월당** 이동 거리 (정규화 좌표 단위). [2026-10-04 단위 통일]
 *
 * [왜 "일" 이 아니라 "월" 인가 — 이 상수가 존재하는 이유]
 * 게임의 1턴은 **1개월** 이다.
 *   game_store.advanceTime() { month += 1; ... }
 * 즉 턴 경계가 곧 월 경계다. 그런데 이 모듈은 처음에 "일" 단위로 움직임을
 * 계산했다. 결과가 어긋났다: `daysTotal: 5` 인 이동이 **턴을 5번** 눌러야
 * 도착했다. "5일" 이 실제로는 5개월이었다.
 *
 * 더 나쁜 것은 속도 자체였다. 정규화 1.0 은 중국 전역 가로폭(67.8도 = 7526km)다.
 * 말 0.085/일 은 **하루 640km, 한 달 19191km** 였다 — 삼국지에서 불가능하다.
 * 말은 하루 40~60km 가 한계다.
 *
 * 그래서 0.2/월 로 다시 잡았다:
 *   0.2 * 7526km = 1505km/월 = 하루 약 50km  ← 실제 말의 체력
 * 배는 그 60% = 하루 30km. 풍향·파도·정박을 고려한 값이다.
 *
 * [이 값이 만드는 감각]
 *   허창 -> 진류 (근거리, 2구간)  : 1개월
 *   진류 -> 연주 (8구간, 해로 포함) : 5개월
 *   하비 -> 업  (12구간, 해로 2회) : 11개월
 *   중국 전역 횡단                : 5~6개월
 * 먼 곳으로 갈수록 실제로 오래 걸린다. 턴제 전략 게임으로 읽힌다.
 *
 * 밸런스 조정이 필요하면 이 상수 두 개만 바꾸면 된다 — 계산 전체가 그 위에서
 * 돌아간다.
 */
export const HORSE_MONTHLY_DISTANCE = 0.2;
/** 배는 말의 60% — 풍향·파도·항구에 정박하는 시간이 든다. */
export const BOAT_SPEED_RATIO = 0.6;
export const BOAT_MONTHLY_DISTANCE = HORSE_MONTHLY_DISTANCE * BOAT_SPEED_RATIO;

/** 한 선분을 표본으로 쪼갤 때의 기준 밀도. */
const LEG_SAMPLES = 24;

/**
 * 꺾은선 경로를 지형에 따라 구간으로 분해한다.
 *
 * [왜 선분별로 따로 판정하는가]
 * 경로(points)는 도로를 따라 꺾이므로 시작점-끝점 직선만 보면 중간의 육지/바다
 * 분포를 놓친다. 각 선분을 따로 판정해야 한다.
 *
 * @param points 도로를 따라가는 정규화 좌표 꺾은선
 * @param isLand 육지 판정
 */
export function splitByTerrain(
    points: ReadonlyArray<{ x: number; y: number }>,
    isLand: LandProbe,
): Array<{ ax: number; ay: number; bx: number; by: number; mode: TransportMode }> {
    if (points.length < 2) return [];
    const legs: Array<{ ax: number; ay: number; bx: number; by: number; mode: TransportMode }> = [];

    for (let s = 0; s < points.length - 1; s++) {
        const a = points[s];
        const b = points[s + 1];
        const segLen = Math.hypot(b.x - a.x, b.y - a.y);
        if (segLen < 1e-9) continue;

        // 이 선분을 표본으로 쪼개 육지/바다 구간을 찾는다. 조각 수가 늘면 정밀해지지만
        // 매 이동마다 비용이 선형으로 오��, 거리 비례로 표본 수를 정한다.
        const steps = Math.max(4, Math.min(LEG_SAMPLES, Math.ceil(segLen * 400)));
        let runStartT = 0; // 현재 구간의 시작 t (경계는 표본점 사이에 둔다)
        let runMode: TransportMode = isLand(a.x, a.y) ? 'HORSE' : 'BOAT';

        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const px = a.x + (b.x - a.x) * t;
            const py = a.y + (b.y - a.y) * t;
            const mode: TransportMode = isLand(px, py) ? 'HORSE' : 'BOAT';
            if (mode !== runMode) {
                // 지형이 바뀌었다 — 이전 구간을 확정하고 새 구간 시작.
                // [경계 계산이 갈리는 이유]
                //   표본 i-1 과 i 사이의 **중간 지점** 이 실제 육지/바다 경계다.
                //   새 구간의 시작을 표본점 i 로 잡으면 이전 구간 끝(중간점)과
                //   사이에 빈틈이 생겨 구간들이 이어지지 않는다. 그래서 새 구간도
                //   같은 중간점에서 시작한다.
                const boundary = (i - 0.5) / steps;
                legs.push({
                    ax: a.x + (b.x - a.x) * runStartT, ay: a.y + (b.y - a.y) * runStartT,
                    bx: a.x + (b.x - a.x) * boundary, by: a.y + (b.y - a.y) * boundary,
                    mode: runMode,
                });
                runStartT = boundary;
                runMode = mode;
            }
        }
        if (runStartT < 1) {
            legs.push({
                ax: a.x + (b.x - a.x) * runStartT, ay: a.y + (b.y - a.y) * runStartT,
                bx: b.x, by: b.y,
                mode: runMode,
            });
        }
    }
    return legs;
}

/**
 * 분해된 구간들의 소요 개월 수를 계산한다.
 *
 * 최소 1개월 규칙 — 왜, 그리고 그 부작용
 *
 * `Math.ceil` 로 올림하고 최소 1개월을 준다. 0.2개월짜리 구간을 0으로 내리면
 * "바로 도착"이 되어 여행의 무게가 사라지고 도착 턴 계산이 어긋난다.
 *
 * 하지만 이 규칙을 **최소 거리 필터 없이** 적용하면 부풀림이 생긴다. 실측:
 * 말 0.0526 + 배 0.0012 + 배 0.0539 인 경로가 최소 1개월씩 올라 1+1+2=4 이
 * 된다. 도중 0.0012 짜리 해로 조각이 1개월(말 30일)을 먹은 것이다.
 *
 * 그래서 `MIN_LEG_DISTANCE` 보다 짧은 조각은 통째로 버린다. 해안선 근처에서
 * 표본 하나만 바다로 잡혀 생기는 0.001 짜리 조각이 전부 이것이다.
 *
 * 최소 거리 필터를 통과한 구간도 최소 1개월은 받는다 — 그래야 턴 경계에서
 * "한 달 만에 도착" 으로 읽힌다.
 */
export const MIN_LEG_DISTANCE = 0.004;

export function computeTravelMonths(
    legs: ReadonlyArray<{
        mode: TransportMode;
        ax: number; ay: number; bx: number; by: number;
    }>,
): TravelLeg[] {
    return legs
        .map(leg => {
            const distance = Math.hypot(leg.bx - leg.ax, leg.by - leg.ay);
            return { ...leg, distance };
        })
        // 최소 거리 미만의 조각은 버린다 — 최소 1개월 규칙의 부풀림 원천 차단.
        .filter(leg => leg.distance >= MIN_LEG_DISTANCE)
        .map(leg => {
            const monthly = leg.mode === 'HORSE' ? HORSE_MONTHLY_DISTANCE : BOAT_MONTHLY_DISTANCE;
            const months = Math.max(1, Math.ceil(leg.distance / monthly));
            return { ...leg, months };
        });
}

/**
 * 이동 계획 — 구간 분해 + 개월 수 계산.
 *
 * 3단계에서 군단이 실제로 이 계획을 따라 움직인다. 지금은 안내 문구와 경로 구간
 * 표시에만 쓴다.
 */
export function planTravel(
    points: ReadonlyArray<{ x: number; y: number }>,
    isLand: LandProbe,
): TravelPlan {
    const legs = computeTravelMonths(splitByTerrain(points, isLand));
    return {
        legs,
        totalMonths: legs.reduce((s, l) => s + l.months, 0),
        totalDistance: legs.reduce((s, l) => s + l.distance, 0),
        legCount: legs.length,
    };
}

/** 수송 방식의 한글 표시. */
export function transportLabel(mode: TransportMode): string {
    return mode === 'HORSE' ? '육로 · 말' : '해로 · 배';
}

/**
 * 이동 계획을 사람이 읽는 한 줄로.
 *
 * 예: "총 4개월 — 육로(말) 2개월 + 해로(배) 2개월"
 * 구간이 하나면 단일 수송으로 표기한다("총 3개월 — 해로(배)").
 */
export function describeTravelPlan(plan: TravelPlan): string {
    if (plan.legCount === 0) return '이동 경로 없음';
    if (plan.legs.length === 1) return `총 ${plan.totalMonths}개월 — ${transportLabel(plan.legs[0].mode)}`;
    // 같은 수송 구간을 합쳐 한 줄로 만든다.
    const parts: string[] = [];
    let i = 0;
    while (i < plan.legs.length) {
        const mode = plan.legs[i].mode;
        let months = 0;
        let j = i;
        while (j < plan.legs.length && plan.legs[j].mode === mode) { months += plan.legs[j].months; j++; }
        parts.push(`${transportLabel(mode)} ${months}개월`);
        i = j;
    }
    return `총 ${plan.totalMonths}개월 — ${parts.join(' + ')}`;
}
