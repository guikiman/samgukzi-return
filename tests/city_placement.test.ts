/**
 * src/core/city_placement.ts 도시 배치 완화기 테스트
 * 파일: tests/city_placement.test.ts
 *
 * 실측 경위도는 AI 생성 지도와 맞지 않으므로 검증 기준도 "해안까지의 거리"로 잡는다.
 * 정합성 3종(isLand / maxMove / minGap)이 동시에 유지되는지가 핵심이다.
 */

import { describe, it, expect } from 'vitest';
import { relaxCityPlacement } from '../src/core/city_placement';
import type { PlacementCity, PlacementResult } from '../src/core/city_placement';

/** 언제나 육지 — 간격 완화만 단독으로 검증할 때 쓴다. */
const allLand = (): boolean => true;

/** 수직 해안선: x < coastX 가 육지, 그 오른쪽이 바다. */
function verticalCoast(coastX: number): (x: number, y: number) => boolean {
    return (x: number): boolean => x < coastX;
}

const EPS = 1e-9;

function pairs(cities: readonly PlacementCity[]): Array<[PlacementCity, PlacementCity]> {
    const out: Array<[PlacementCity, PlacementCity]> = [];
    for (let i = 0; i < cities.length; i++) {
        for (let j = i + 1; j < cities.length; j++) out.push([cities[i], cities[j]]);
    }
    return out;
}

/** 최종 좌표에서 최소 쌍간 거리를 구한다. */
function minPairDistance(result: PlacementResult, ids: readonly string[]): number {
    let min = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
            const a = result.positions.get(ids[i]);
            const b = result.positions.get(ids[j]);
            if (a === undefined || b === undefined) continue;
            min = Math.min(min, Math.hypot(a.x - b.x, a.y - b.y));
        }
    }
    return min;
}

describe('relaxCityPlacement — 도시 배치 완화', () => {
    it('1. 빈 입력은 빈 결과를 내고 예외를 던지지 않는다', () => {
        const result = relaxCityPlacement([], { isLand: allLand });
        expect(result.positions.size).toBe(0);
        expect(result.moved.size).toBe(0);
        expect(result.offLand).toEqual([]);
    });

    it('2. 단일 도시는 maxMove 이내에서 원본에 가깝게 머문다', () => {
        const result = relaxCityPlacement(
            [{ id: 'a', x: 0.4, y: 0.6 }],
            { isLand: allLand, maxMove: 0.1, minGap: 0.5, coastBias: 1, iterations: 100 },
        );
        const p = result.positions.get('a');
        expect(p).toBeDefined();
        if (p === undefined) return;
        expect(Math.hypot(p.x - 0.4, p.y - 0.6)).toBeLessThanOrEqual(0.1 + EPS);
        expect(result.moved.get('a')).toBeLessThanOrEqual(0.1 + EPS);
        expect(result.offLand).toEqual([]);
    });

    it('3. minGap 이 지켜진다 — 겹쳐 있던 도시들이 전부 벌려진다', () => {
        // 원본이 0.05 반경 안에 몰려 있고 minGap(0.08) 보다 훨씬 빽빽하다.
        const cities: PlacementCity[] = [
            { id: 'c0', x: 0.50, y: 0.50 },
            { id: 'c1', x: 0.51, y: 0.50 },
            { id: 'c2', x: 0.50, y: 0.51 },
            { id: 'c3', x: 0.51, y: 0.51 },
            { id: 'c4', x: 0.505, y: 0.515 },
            { id: 'c5', x: 0.495, y: 0.495 },
            { id: 'c6', x: 0.52, y: 0.505 },
            { id: 'c7', x: 0.49, y: 0.51 },
        ];
        const minGap = 0.08;
        const result = relaxCityPlacement(cities, {
            isLand: allLand,
            maxMove: 0.5,
            minGap,
            coastBias: 0,
            iterations: 800,
        });
        const ids = cities.map((c) => c.id);
        expect(result.positions.size).toBe(cities.length);
        expect(minPairDistance(result, ids)).toBeGreaterThanOrEqual(minGap - 1e-6);
    });

    it('4. maxMove 가 지켜진다 — 지형이 도시를 멀리 끌어내도 원반을 넘지 않는다', () => {
        const cities: PlacementCity[] = [
            { id: 'a', x: 0.30, y: 0.30 },
            { id: 'b', x: 0.32, y: 0.30 },
            { id: 'c', x: 0.31, y: 0.32 },
            { id: 'd', x: 0.30, y: 0.31 },
        ];
        const maxMove = 0.05;
        const result = relaxCityPlacement(cities, {
            // 내륙 판정 함수가 도시를 바다 쪽으로 아주 세게 끌어당기는 극단 상황
            isLand: (x, y) => x + y * 0.0001 < 0.31 + 0.0001,
            maxMove,
            minGap: 0.5,
            coastBias: 1,
            iterations: 300,
        });
        for (const city of cities) {
            expect(result.moved.get(city.id)).toBeLessThanOrEqual(maxMove + EPS);
            const p = result.positions.get(city.id);
            expect(p).toBeDefined();
            if (p === undefined) continue;
            expect(Math.hypot(p.x - city.x, p.y - city.y)).toBeLessThanOrEqual(maxMove + EPS);
            expect(p.x).toBeGreaterThanOrEqual(0);
            expect(p.x).toBeLessThanOrEqual(1);
            expect(p.y).toBeGreaterThanOrEqual(0);
            expect(p.y).toBeLessThanOrEqual(1);
        }
    });

    it('5. 어떤 도시도 바다에 남지 않는다 — 왼쪽 육지 / 오른쪽 바다', () => {
        // 해안선 바로 안쪽에 몰아넣어 간격 완화가 바다 쪽으로 밀어내게 만든다.
        const cities: PlacementCity[] = [
            { id: 'a', x: 0.40, y: 0.20 },
            { id: 'b', x: 0.45, y: 0.25 },
            { id: 'c', x: 0.49, y: 0.30 },
            { id: 'd', x: 0.42, y: 0.35 },
            { id: 'e', x: 0.47, y: 0.40 },
            { id: 'f', x: 0.44, y: 0.45 },
        ];
        const result = relaxCityPlacement(cities, {
            isLand: verticalCoast(0.5),
            maxMove: 0.4,
            minGap: 0.09,
            coastBias: 1,
            iterations: 300,
        });
        expect(result.offLand).toEqual([]);
        for (const city of cities) {
            const p = result.positions.get(city.id);
            expect(p).toBeDefined();
            if (p === undefined) continue;
            expect(verticalCoast(0.5)(p.x, p.y)).toBe(true);
        }
    });

    it('6. coastBias 가 도시를 바다 쪽으로 끌어당긴다 (평균 해안 거리 감소)', () => {
        const isLand = verticalCoast(0.5);
        const cities: PlacementCity[] = [];
        // y 간격이 minGap 보다 넓어 간격 완화가 개입하지 않게 한다.
        for (let k = 0; k < 9; k++) {
            cities.push({ id: `c${k}`, x: 0.2 + k * 0.0275, y: 0.05 + k * 0.1125 });
        }
        const coastX = 0.5;
        const meanBefore =
            cities.reduce((sum, c) => sum + (coastX - c.x), 0) / cities.length;

        const result = relaxCityPlacement(cities, {
            isLand,
            maxMove: 0.4,
            minGap: 0.02,
            coastBias: 1,
            iterations: 240,
        });
        expect(result.offLand).toEqual([]);
        const meanAfter =
            cities.reduce(
                (sum, c) => sum + (coastX - (result.positions.get(c.id)?.x ?? c.x)),
                0,
            ) / cities.length;
        expect(meanAfter).toBeLessThan(meanBefore);
    });

    it('7. coastBias 0 이면 해안 쪽으로 흐르지 않고, 간격만 강제된다', () => {
        const isLand = verticalCoast(0.5);
        // (a) 이미 충분히 떨어진 도시 — 아무것도 움직이지 않아야 한다
        const spaced: PlacementCity[] = [
            { id: 'a', x: 0.10, y: 0.10 },
            { id: 'b', x: 0.10, y: 0.70 },
            { id: 'c', x: 0.30, y: 0.40 },
        ];
        const noDrift = relaxCityPlacement(spaced, {
            isLand,
            maxMove: 0.2,
            minGap: 0.05,
            coastBias: 0,
            iterations: 100,
        });
        for (const city of spaced) {
            expect(noDrift.moved.get(city.id) ?? 0).toBeLessThanOrEqual(1e-12);
        }
        expect(noDrift.offLand).toEqual([]);

        // (b) 겹쳐 있는 도시 — coastBias 가 0 이어도 minGap 은 강제된다
        const clustered: PlacementCity[] = [
            { id: 'p', x: 0.20, y: 0.50 },
            { id: 'q', x: 0.21, y: 0.50 },
            { id: 'r', x: 0.205, y: 0.505 },
        ];
        const minGap = 0.1;
        const spacedOut = relaxCityPlacement(clustered, {
            isLand,
            maxMove: 0.3,
            minGap,
            coastBias: 0,
            iterations: 500,
        });
        expect(spacedOut.offLand).toEqual([]);
        expect(minPairDistance(spacedOut, clustered.map((c) => c.id))).toBeGreaterThanOrEqual(
            minGap - 1e-6,
        );
    });

    it('8. 결정론 — 같은 입력은 항상 같은 출력 (Math.random 금지)', () => {
        const cities: PlacementCity[] = [];
        for (let k = 0; k < 12; k++) {
            cities.push({ id: `c${k}`, x: 0.15 + ((k * 37) % 30) / 100, y: 0.1 + k * 0.05 });
        }
        const options = {
            isLand: verticalCoast(0.62),
            maxMove: 0.15,
            minGap: 0.05,
            coastBias: 0.7,
            iterations: 150,
        };
        const first = relaxCityPlacement(cities, options);
        const second = relaxCityPlacement(cities, options);
        expect([...second.positions.keys()]).toEqual([...first.positions.keys()]);
        for (const [id, p] of first.positions) {
            const q = second.positions.get(id);
            expect(q).toBeDefined();
            if (q === undefined) continue;
            expect(q.x).toBe(p.x);
            expect(q.y).toBe(p.y);
            expect(second.moved.get(id)).toBe(first.moved.get(id));
        }
        expect(second.offLand).toEqual(first.offLand);
    });

    it('9-1. 퇴화 입력: 모든 도시가 완전히 같은 점에 있어도 예외 없이 처리된다', () => {
        const cities: PlacementCity[] = [];
        for (let k = 0; k < 8; k++) cities.push({ id: `c${k}`, x: 0.5, y: 0.5 });
        const maxMove = 0.3;
        const result = relaxCityPlacement(cities, {
            isLand: allLand,
            maxMove,
            minGap: 0.05,
            coastBias: 1,
            iterations: 120,
        });
        expect(result.positions.size).toBe(cities.length);
        expect(result.offLand).toEqual([]);
        // 완전 중첩이 해소되어 서로 다른 좌표가 되어야 한다
        const distinct = new Set(
            cities.map((c) => {
                const p = result.positions.get(c.id);
                return `${p?.x.toFixed(9)},${p?.y.toFixed(9)}`;
            }),
        );
        expect(distinct.size).toBe(cities.length);
        for (const city of cities) {
            expect(result.moved.get(city.id) ?? 0).toBeLessThanOrEqual(maxMove + EPS);
        }
    });

    it('9-2. 퇴화 입력: maxMove 0 이면 아무 도시도 움직이지 않는다', () => {
        const cities: PlacementCity[] = [
            { id: 'a', x: 0.30, y: 0.30 },
            { id: 'b', x: 0.305, y: 0.302 },
            { id: 'c', x: 0.31, y: 0.295 },
        ];
        const result = relaxCityPlacement(cities, {
            isLand: verticalCoast(0.5),
            maxMove: 0,
            minGap: 0.2,
            coastBias: 1,
            iterations: 200,
        });
        for (const city of cities) {
            const p = result.positions.get(city.id);
            expect(p).toBeDefined();
            if (p === undefined) continue;
            expect(p.x).toBeCloseTo(city.x, 12);
            expect(p.y).toBeCloseTo(city.y, 12);
            expect(result.moved.get(city.id)).toBe(0);
        }
    });

    it('9-3. 퇴화 입력: 이미 충분히 떨어진 도시들은 원래 자리에 그대로 남는다', () => {
        const cities: PlacementCity[] = [
            { id: 'a', x: 0.05, y: 0.05 },
            { id: 'b', x: 0.95, y: 0.05 },
            { id: 'c', x: 0.05, y: 0.95 },
            { id: 'd', x: 0.95, y: 0.95 },
        ];
        const result = relaxCityPlacement(cities, {
            isLand: allLand,
            maxMove: 0.25,
            minGap: 0.02,
            coastBias: 0,
            iterations: 200,
        });
        for (const city of cities) {
            const p = result.positions.get(city.id);
            expect(p).toBeDefined();
            if (p === undefined) continue;
            expect(p.x).toBeCloseTo(city.x, 12);
            expect(p.y).toBeCloseTo(city.y, 12);
        }
    });

    it('10. 입력 배열과 객체를 변경하지 않는다', () => {
        const cities: PlacementCity[] = [
            { id: 'a', x: 0.4, y: 0.4 },
            { id: 'b', x: 0.41, y: 0.4 },
            { id: 'c', x: 0.4, y: 0.41 },
        ];
        const snapshot = JSON.parse(JSON.stringify(cities)) as PlacementCity[];
        const lengthBefore = cities.length;
        const result = relaxCityPlacement(cities, {
            isLand: verticalCoast(0.5),
            maxMove: 0.2,
            minGap: 0.08,
            coastBias: 1,
            iterations: 120,
        });
        expect(cities.length).toBe(lengthBefore);
        expect(JSON.parse(JSON.stringify(cities))).toEqual(snapshot);
        // 결과 맵의 좌표 객체는 원본과 공유되지 않는다
        const p = result.positions.get('a');
        expect(p).toBeDefined();
        if (p === undefined) return;
        expect(p).not.toBe(cities[0]);
        expect(p).toEqual(result.positions.get('a'));
    });
});
