import { describe, it, expect } from 'vitest';
import {
    splitByTerrain,
    computeTravelMonths,
    planTravel,
    describeTravelPlan,
    transportLabel,
    HORSE_MONTHLY_DISTANCE,
    BOAT_MONTHLY_DISTANCE,
    type TransportMode,
} from '../src/core/travel_transport.js';

/**
 * 지형 더미 — x 가 0.4 미만이면 육지, 그 이상이면 바다.
 *
 * [왜 단순한 세로 경계인가]
 * 경계가 수직선 하나라서 "여기서 육지 끝났고 바다 시작" 을 눈으로 확인하기 쉽다.
 * 실제 지형 마스크는 테스트에서 만들기엔 크고 불안정하다.
 */
const landLeftOf04 = (x: number, _y: number): boolean => x < 0.4;

describe('travel_transport — 육로(말) / 해로(배) 분해', () => {
    it('모두 육지인 경로는 전부 말이다', () => {
        const legs = splitByTerrain([
            { x: 0.1, y: 0.5 }, { x: 0.2, y: 0.5 }, { x: 0.3, y: 0.5 },
        ], landLeftOf04);
        expect(legs.length).toBeGreaterThan(0);
        expect(legs.every(l => l.mode === 'HORSE')).toBe(true);
    });

    it('모두 바다인 경로는 전부 배이다', () => {
        const legs = splitByTerrain([
            { x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.7, y: 0.5 },
        ], landLeftOf04);
        expect(legs.length).toBeGreaterThan(0);
        expect(legs.every(l => l.mode === 'BOAT')).toBe(true);
    });

    it('육지에서 바다가 시작되면 구간이 나뉜다 (말 구간 + 배 구간)', () => {
        const legs = splitByTerrain([
            { x: 0.2, y: 0.5 },   // 육지
            { x: 0.6, y: 0.5 },   // 바다
        ], landLeftOf04);
        const modes = legs.map(l => l.mode);
        expect(modes, '육로와 해로가 모두 있어야 한다').toContain('HORSE');
        expect(modes, '육로와 해로가 모두 있어야 한다').toContain('BOAT');
        // 첫 구간은 육지, 마지막 구간은 바다여야 한다.
        expect(modes[0]).toBe('HORSE');
        expect(modes[modes.length - 1]).toBe('BOAT');
    });

    it('구간은 순서대로 이어진다 — 이전 구간 끝 = 다음 구간 시작', () => {
        const legs = splitByTerrain([
            { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 },
        ], landLeftOf04);
        for (let i = 1; i < legs.length; i++) {
            expect(legs[i].ax, `구간 ${i} 가 이어지지 않는다`).toBeCloseTo(legs[i - 1].bx, 6);
            expect(legs[i].ay, `구간 ${i} 가 이어지지 않는다`).toBeCloseTo(legs[i - 1].by, 6);
        }
    });

    it('점이 1개 이하면 구간이 없다', () => {
        expect(splitByTerrain([], landLeftOf04)).toEqual([]);
        expect(splitByTerrain([{ x: 0.1, y: 0.5 }], landLeftOf04)).toEqual([]);
    });
});

describe('travel_transport — 소요 시간', () => {
    it('같은 거리라도 배가 말보다 오래 걸린다', () => {
        // [왜 이게 핵심인가] 배가 육로보다 빠르면 "바다를 돌아간다" 는 선택이
        // 손해가 되어 sea/horse 분기가 무의미해진다. 배가 느려야 해로가 의미를 가진다.
        expect(BOAT_MONTHLY_DISTANCE).toBeLessThan(HORSE_MONTHLY_DISTANCE);
        const dist = 0.2;
        const horse = Math.ceil(dist / HORSE_MONTHLY_DISTANCE);
        const boat = Math.ceil(dist / BOAT_MONTHLY_DISTANCE);
        expect(boat, '배가 말보다 느리지 않다').toBeGreaterThan(horse);
    });

    it('거리가 길수록 시간이 길다 (비례 관계)', () => {
        const near = computeTravelMonths([{ mode: 'HORSE' as TransportMode, ax: 0, ay: 0, bx: 0.1, by: 0 }]);
        const far = computeTravelMonths([{ mode: 'HORSE' as TransportMode, ax: 0, ay: 0, bx: 0.5, by: 0 }]);
        expect(far[0].months).toBeGreaterThan(near[0].months);
    });

    it('아주 짧은 구간도 최소 1일이다 — 0 일이 되면 여행의 무게가 사라진다', () => {
        const [leg] = computeTravelMonths([{ mode: 'HORSE' as TransportMode, ax: 0, ay: 0, bx: 0.02, by: 0 }]);
        expect(leg.months, '0 일로 내려가면 안 된다').toBe(1);
    });

    // [실측에서 발견한 부풀림] 최소 1일 규칙을 최소 거리 필터 없이 적용하면
    // 해안선 근처에서 생기는 0.001 짜리 조각이 각각 1일(= 말 24시간)을 먹는다.
    // 실측 사례: 말 0.0526 + 배 0.0012 + 배 0.0539 → 1+1+2 = 4일 이 되어야
    // 정상이지만, 필터가 없으면 더 부풀고 필터가 있으면 1+2 = 3일 이 된다.
    it('최소 거리 미만의 조각은 버린다 — 최소 1일 규칙의 부풀림을 막는다', () => {
        const legs = computeTravelMonths([
            { mode: 'HORSE', ax: 0, ay: 0, bx: 0.0526, by: 0 },
            { mode: 'BOAT', ax: 0.0526, ay: 0, bx: 0.0538, by: 0 }, // 0.0012 짜리
            { mode: 'BOAT', ax: 0.0538, ay: 0, bx: 0.1077, by: 0 },
        ]);
        expect(legs.length, '0.0012 짜리 조각이 남아 있다').toBe(2);
        expect(legs.map(l => l.mode)).toEqual(['HORSE', 'BOAT']);
        // 버리지 않았으면 1+1+2=4 일이 된다.
        expect(legs.reduce((s, l) => s + l.months, 0)).toBeLessThan(4);
    });

    it('최소 거리 미만 조각만 있으면 계획이 비어 있다', () => {
        const legs = computeTravelMonths([
            { mode: 'BOAT', ax: 0, ay: 0, bx: 0.001, by: 0 },
        ]);
        expect(legs).toEqual([]);
    });

    it('총 시간은 구간 시간의 합이다', () => {
        const plan = planTravel([{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], landLeftOf04);
        const sum = plan.legs.reduce((s, l) => s + l.months, 0);
        expect(plan.totalMonths).toBe(sum);
        expect(plan.totalMonths).toBeGreaterThan(0);
    });

    it('구간과 구간의 거리를 더하면 총 거리와 같다', () => {
        const plan = planTravel([{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], landLeftOf04);
        const sum = plan.legs.reduce((s, l) => s + l.distance, 0);
        expect(plan.totalDistance).toBeCloseTo(sum, 9);
    });
});

describe('travel_transport — 사람이 읽는 설명', () => {
    it('수송 라벨이 말/배를 구분한다', () => {
        expect(transportLabel('HORSE')).toContain('말');
        expect(transportLabel('BOAT')).toContain('배');
    });

    it('단일 구간이면 "총 N개월 — 수송" 형식', () => {
        const plan = planTravel([{ x: 0.1, y: 0.5 }, { x: 0.2, y: 0.5 }], landLeftOf04);
        const text = describeTravelPlan(plan);
        expect(text).toMatch(/^총 \d+개월 — /);
        expect(text).toContain('말');
    });

    it('혼합 경로면 육로와 해로가 함께 표기된다', () => {
        const plan = planTravel([{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], landLeftOf04);
        const text = describeTravelPlan(plan);
        expect(text).toContain('육로');
        expect(text).toContain('해로');
        expect(text).toContain('+');
    });

    it('경로가 없으면 빈 계획이 아니라 "없음" 이라고 말한다', () => {
        expect(describeTravelPlan(planTravel([], landLeftOf04))).toBe('이동 경로 없음');
    });

    it('설명에 총 개월 수가 들어간다', () => {
        const plan = planTravel([{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], landLeftOf04);
        expect(describeTravelPlan(plan)).toContain(`총 ${plan.totalMonths}개월`);
    });
});
