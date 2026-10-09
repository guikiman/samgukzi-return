import { describe, it, expect } from 'vitest';
import { traceIsoContours, type ContourSegment } from '../src/core/marching_squares.js';

/** cols x rows row-major 필드를 만든다. */
function grid(cols: number, rows: number, fn: (gx: number, gy: number) => number): Float32Array {
    const out = new Float32Array(Math.max(0, cols * rows));
    for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) out[gy * cols + gx] = fn(gx, gy);
    }
    return out;
}

function allFinite(segs: ContourSegment[]): boolean {
    return segs.every(
        (s) =>
            Number.isFinite(s.x0) &&
            Number.isFinite(s.y0) &&
            Number.isFinite(s.x1) &&
            Number.isFinite(s.y1),
    );
}

function length(s: ContourSegment): number {
    return Math.hypot(s.x1 - s.x0, s.y1 - s.y0);
}

function maxLength(segs: ContourSegment[]): number {
    return segs.reduce((m, s) => Math.max(m, length(s)), 0);
}

describe('marching squares 등고선 추적기', () => {
    it('1. level 과 전부 같은 필드는 선분을 내지 않는다', () => {
        expect(traceIsoContours(grid(3, 3, () => 0), 3, 3)).toEqual([]);
        expect(traceIsoContours(grid(8, 8, () => 1.5), 8, 8, 1.5)).toEqual([]);
        // a === b 모서리는 교차로 세지 않아야 한다(0 나눗셈 방지).
        expect(traceIsoContours(grid(2, 2, () => 0), 2, 2, 0, false)).toEqual([]);
    });

    it('1-기본값. level=0, chain=true 가 기본값이다', () => {
        const field = grid(6, 5, (gx) => (gx < 3 ? 1 : -1));
        expect(traceIsoContours(field, 6, 5)).toEqual(traceIsoContours(field, 6, 5, 0, true));
        expect(traceIsoContours(field, 6, 5).length).toBe(1);
    });

    it('2. 음수 속 양수 한 샘플은 닫힌 고리를 만든다', () => {
        // 양수 샘플은 정수 좌표 (1,1) 에 있다. 샘플이 셀 중심이 아니므로
        // 그 주위의 등고선은 반 셀(0.5)만큼 바깥까지 뻗는다. 따라서 검사 상자는
        // 샘플을 둘러싼 ±0.5 하이라(= 셀 바깥 경계)여야 한다.
        const field = grid(3, 3, (gx, gy) => (gx === 1 && gy === 1 ? 1 : -1));

        const raw = traceIsoContours(field, 3, 3, 0, false);
        expect(raw.length).toBe(4);

        const loop = traceIsoContours(field, 3, 3);
        expect(loop.length).toBe(1);
        // 닫힌 고리: 시작점과 끝점이 같다.
        expect(length(loop[0])).toBeLessThan(1e-9);

        const pts: Array<[number, number]> = [
            [loop[0].x0, loop[0].y0],
            [loop[0].x1, loop[0].y1],
            [raw[0].x1, raw[0].y1],
            [raw[1].x1, raw[1].y1],
        ];
        for (const [x, y] of pts) {
            expect(x).toBeGreaterThanOrEqual(0.5);
            expect(x).toBeLessThanOrEqual(1.5);
            expect(y).toBeGreaterThanOrEqual(0.5);
            expect(y).toBeLessThanOrEqual(1.5);
        }
    });

    it('3. 수직 반평면 분할은 분할선 위에만 선분을 만든다', () => {
        const cols = 8;
        const rows = 4;
        const field = grid(cols, rows, (gx) => (gx < 4 ? 1 : -1));

        // 분할은 샘플 x=3 과 x=4 사이이므로 등고선은 x = 3.5 에 선다.
        for (const chained of [false, true]) {
            const segs = traceIsoContours(field, cols, rows, 0, chained);
            expect(segs.length).toBeGreaterThan(0);
            for (const s of segs) {
                expect(Math.abs(s.x0 - 3.5)).toBeLessThan(1e-9);
                expect(Math.abs(s.x1 - 3.5)).toBeLessThan(1e-9);
            }
        }
    });

    it('4. 선형 보간이 정확하다 (0 과 2 사이 level 1 은 t=0.5)', () => {
        // 2x2: [[0, 2], [0, 2]] → B, C 가 안쪽 → case 6, 세로 등고선.
        const vertical = grid(2, 2, (gx) => (gx === 0 ? 0 : 2));
        const segs = traceIsoContours(vertical, 2, 2, 1, false);
        expect(segs.length).toBe(1);
        expect(segs[0].x0).toBe(0.5);
        expect(segs[0].x1).toBe(0.5);
        expect(segs[0].y0).toBe(0);
        expect(segs[0].y1).toBe(1);
        // 모서리(0 또는 1)로 떨어지지 않아야 한다.
        expect(segs[0].x0).not.toBe(0);
        expect(segs[0].x0).not.toBe(1);

        // 2x2: [[0, 2], [0, 0]] → B 만 안쪽 → case 4, 대각선 등고선.
        const corner = grid(2, 2, (gx, gy) => (gx === 1 && gy === 0 ? 2 : 0));
        const cornerSegs = traceIsoContours(corner, 2, 2, 1, false);
        expect(cornerSegs.length).toBe(1);
        expect(cornerSegs[0].x0).toBeCloseTo(0.5, 12);
        expect(cornerSegs[0].y0).toBe(0);
        expect(cornerSegs[0].x1).toBe(1);
        expect(cornerSegs[0].y1).toBeCloseTo(0.5, 12);
    });

    it('5. 체커보드 saddle 은 결정적이며 NaN 이 없다', () => {
        const cols = 4;
        const rows = 4;
        const field = grid(cols, rows, (gx, gy) => ((gx + gy) % 2 === 0 ? 1 : -1));

        // 9 셀 전부 saddle(경계 셀 포함) → 셀마다 2 선분.
        const raw = traceIsoContours(field, cols, rows, 0, false);
        expect(raw.length).toBe(18);
        expect(allFinite(raw)).toBe(true);

        // 양수 샘플 8개 각각이 하나의 폴리라인으로 모인다(내부 정점은 닫힌 다이아몬드).
        const chained = traceIsoContours(field, cols, rows, 0, true);
        expect(chained.length).toBe(8);
        expect(allFinite(chained)).toBe(true);

        const again = traceIsoContours(field, cols, rows, 0, true);
        expect(again).toStrictEqual(chained);
        expect(traceIsoContours(field, cols, rows, 0, false)).toStrictEqual(raw);
    });

    it('5-saddle 규칙. case 5 는 case 10 을 뒤집은 해석으로 고정된다 (중심 = 낮은 쪽)', () => {
        // [[0, 1], [1, 0]], level 0.5 → B, D 안쪽 = case 5.
        // 중심을 낮은 쪽으로 고정하므로 B 와 D 는 서로 분리된 두 조각이 된다.
        const saddle = grid(2, 2, (gx, gy) => ((gx + gy) % 2 === 0 ? 0 : 1));
        const segs = traceIsoContours(saddle, 2, 2, 0.5, false);
        expect(segs.length).toBe(2);
        const keyed = segs
            .map((s) => `${s.x0},${s.y0}|${s.x1},${s.y1}`)
            .sort();
        expect(keyed).toEqual(['0,0.5|0.5,1', '0.5,0|1,0.5']);
    });

    it('6. chain:true 는 선분 수가 줄고 길이가 늘어난다', () => {
        const cols = 8;
        const rows = 4;
        const field = grid(cols, rows, (gx) => (gx < 4 ? 1 : -1));

        // 샘플 4행 → 셀 3행이므로 분할선을 가로지르는 셀은 3개.
        const cellRows = rows - 1;
        const raw = traceIsoContours(field, cols, rows, 0, false);
        const chained = traceIsoContours(field, cols, rows, 0, true);

        expect(raw.length).toBe(cellRows);
        expect(chained.length).toBe(1);
        expect(chained.length).toBeLessThan(raw.length);
        expect(maxLength(chained)).toBeGreaterThan(maxLength(raw));
        expect(chained[0].y0).toBeCloseTo(cellRows, 12);
        expect(chained[0].y1).toBeCloseTo(0, 12);
    });

    it('7. 비정상 입력에도 예외 없이 NaN 없는 출력을 낸다', () => {
        const nanInf = grid(6, 6, (gx, gy) => {
            if (gx === 0) return Number.NaN;
            if (gx === 1) return Number.POSITIVE_INFINITY;
            if (gx === 2) return Number.NEGATIVE_INFINITY;
            return gx + gy < 5 ? 1 : -1;
        });

        const cases: Array<[string, Float32Array, number, number]> = [
            ['cols=1', grid(1, 4, () => 1), 1, 4],
            ['rows=1', grid(4, 1, () => 1), 4, 1],
            ['cols=0', new Float32Array(0), 0, 0],
            ['rows=0', new Float32Array(0), 0, 0],
            ['음수 크기', new Float32Array(0), -3, -3],
            ['잘린 필드', new Float32Array([1, -1, 1, -1, 1]), 8, 8],
            ['빈 필드', new Float32Array(0), 4, 4],
            ['NaN/Infinity 포함', nanInf, 6, 6],
            ['NaN 크기', grid(4, 4, (gx) => (gx < 2 ? 1 : -1)), Number.NaN, 4],
        ];

        for (const [name, field, cols, rows] of cases) {
            for (const chained of [false, true]) {
                let segs: ContourSegment[] = [];
                expect(() => {
                    segs = traceIsoContours(field, cols, rows, 0, chained);
                }, name).not.toThrow();
                expect(allFinite(segs), `${name} (chain=${chained})`).toBe(true);
            }
        }

        // cols<2 / rows<2 는 등고선을 만들 셀이 없으므로 항상 빈 배열.
        expect(traceIsoContours(nanInf, 1, 6)).toEqual([]);
        expect(traceIsoContours(nanInf, 6, 1)).toEqual([]);
    });

    it('8. 같은 입력은 언제나 같은 출력이다 (결정성)', () => {
        let seed = 20260930;
        const next = (): number => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };
        const cols = 16;
        const rows = 16;
        const field = grid(cols, rows, (gx, gy) => {
            const r = next();
            const gxCenter = gx - cols / 2;
            const gyCenter = gy - rows / 2;
            return r * 0.6 - (gxCenter * gxCenter + gyCenter * gyCenter) * 0.05;
        });

        for (const chained of [false, true]) {
            const a = traceIsoContours(field, cols, rows, 0, chained);
            const b = traceIsoContours(field, cols, rows, 0, chained);
            expect(a.length).toBeGreaterThan(0);
            expect(allFinite(a)).toBe(true);
            expect(b).toStrictEqual(a);
        }

        // 소수 크기 필드도 안전해야 한다.
        const tiny = grid(5, 5, (gx, gy) => (gx * 1e-30 + gy * 1e-30 - 3e-30));
        expect(allFinite(traceIsoContours(tiny, 5, 5, 0, true))).toBe(true);
    });

    it('9. 모서리에 level 과 정확히 같은 값이 있어도 NaN 이 없다', () => {
        const cols = 3;
        const rows = 3;
        const raw = [0, 0.5, -1, 1, 0, -1, -1, -1, 1];
        const field = Float32Array.from(raw);

        for (const chained of [false, true]) {
            const segs = traceIsoContours(field, cols, rows, 0, chained);
            expect(segs.length).toBeGreaterThan(0);
            expect(allFinite(segs)).toBe(true);
        }
        expect(traceIsoContours(field, cols, rows, 0, true)).toStrictEqual(
            traceIsoContours(field, cols, rows, 0, true),
        );

        // 전 모서리가 level 인 경우: 0/0 이 아니라 교차 0 개.
        expect(traceIsoContours(Float32Array.from([0, 0, 0, 0]), 2, 2, 0)).toEqual([]);
    });
});
