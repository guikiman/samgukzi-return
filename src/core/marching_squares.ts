/**
 * 마칭 스퀘어(marching squares) 순수 등고선 추적기.
 *
 * 세력 국경은 reach 필드(양수 = 아군 소유, 0 = 국경)를 원본으로 삼는다.
 * 셀마다 `fillRect` 을 그리면 계단(staircase) 계단이 보이므로,
 * 각 셀에서 등고선이 지나는 두 점을 선형 보간으로 구해 선분으로 연결한다.
 *
 * 좌표계는 그리드 인덱스 공간이다. 즉 샘플 `field[gy*cols+gx]` 의 좌표는
 * `(gx, gy)` 이고 등고선 결과의 x 는 `[0, cols]`, y 는 `[0, rows]` 범위다.
 * (셀 중심이 아니라 샘플 자체가 정수 좌표를 갖는다는 점에 주의.)
 * 실제로 셀이 갯수만큼만 존재하므로 도달 가능한 좌표는
 * x ∈ [0, cols-1], y ∈ [0, rows-1] 이고, 셀 모서리는 언제나 샘플과 일치한다.
 *
 * 순수 함수이며 `src/` 를 import 하지 않는다. 어떤 입력에도 예외를 던지지 않고
 * 출력에 NaN 을 내보내지 않으며, 같은 입력이면 언제나 같은 출력을 낸다.
 */

/** 등고선의 한 선분. 좌표는 그리드 인덱스 공간(원점 = 첫 샘플). */
export interface ContourSegment {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

/** 끝점 비교 허용 오차. 체이닝은 이 오차 이내로 양끝이 일치하는 것만 이어 붙인다. */
const EPSILON_SCALE = 1e6;

/**
 * 샘플 하나를 안전하게 읽는다.
 * 범위를 벗어나거나(잘린 필드) NaN/Infinity 면 등고선을 만들 수 없으므로
 * `level` 로 치환한다. 이후 그 모서리는 a === b 가 되어 교차로 세지지 않는다.
 */
function sampleAt(field: Float32Array, index: number, level: number): number {
    if (index < 0 || index >= field.length) return level;
    const v = field[index];
    return Number.isFinite(v) ? v : level;
}

/**
 * 모서리 (ax,ay)-(bx,by) 위에 있는 등고선 교점을 out 에 쓰고 true 를 돌려준다.
 * a === b 이면 그 모서리는 교차하지 않는다(0 으로 나누지 않기 위함).
 * t 는 [0,1] 로 클램프하여 부동소수 오차로 셀 바깥으로 나가는 것을 막는다.
 */
function writeEdgePoint(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    a: number,
    b: number,
    level: number,
    out: Float64Array,
): boolean {
    if (a === b) return false;
    const t = (level - a) / (b - a);
    if (!Number.isFinite(t)) return false;
    const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
    out[0] = ax + clamped * (bx - ax);
    out[1] = ay + clamped * (by - ay);
    return true;
}

/** 좌표를 1e-6 격자로 양자화한 키. 동일 교점은 항상 같은 키가 된다. */
function endpointKey(x: number, y: number): string {
    const qx = Math.round(x * EPSILON_SCALE);
    const qy = Math.round(y * EPSILON_SCALE);
    return `${qx === 0 ? 0 : qx}:${qy === 0 ? 0 : qy}`;
}

/**
 * 끝점을 공유하는 선분들을 하나의 폴리라인으로 잇는다.
 *
 * 끝점 키 → 선분 인덱스 목록(해시 맵)만 만들어 두면 선분 수 n 에 대해 O(n) 이다.
 * 모든 쌍을 비교하는 O(n^2) 방식은 수천 개 선분에서 사용 불가.
 * 방향은 무관하므로 연결 순서가 달라도 결과는 결정적이다(정렬된 입력 순서 기준).
 */
function joinChains(segs: ContourSegment[]): ContourSegment[] {
    const n = segs.length;
    if (n < 2) return segs.slice();

    const adj = new Map<string, number[]>();
    const register = (key: string, i: number): void => {
        const bucket = adj.get(key);
        if (bucket === undefined) adj.set(key, [i]);
        else bucket.push(i);
    };
    for (let i = 0; i < n; i++) {
        register(endpointKey(segs[i].x0, segs[i].y0), i);
        register(endpointKey(segs[i].x1, segs[i].y1), i);
    }

    const used = new Uint8Array(n);
    const out: ContourSegment[] = [];
    for (let i = 0; i < n; i++) {
        if (used[i] === 1) continue;
        used[i] = 1;
        let hx = segs[i].x0;
        let hy = segs[i].y0;
        let tx = segs[i].x1;
        let ty = segs[i].y1;
        let chainLen = 1;
        // 0 = 시작점(뒤)으로 연장, 1 = 끝점(앞)으로 연장.
        // 앞쪽만 보면 앞선 체인이 뒤쪽 이웃을 먼저 먹어 같은 폴리라인이 잘릴 수 있다.
        for (let dir = 0; dir < 2; dir++) {
            const atHead = dir === 0;
            for (;;) {
                const key = atHead ? endpointKey(hx, hy) : endpointKey(tx, ty);
                const bucket = adj.get(key);
                if (bucket === undefined) break;
                let next = -1;
                let nextForward = false;
                for (let c = 0; c < bucket.length; c++) {
                    const idx = bucket[c];
                    if (used[idx] === 1) continue;
                    const cand = segs[idx];
                    nextForward = endpointKey(cand.x0, cand.y0) === key;
                    // 첫 선분만 이은 상태에서 그대로 되짚으면 길이 0 폴리라인이 되므로 건너뛴다.
                    // 2개 이상 이은 뒤 반대편 끝으로 돌아오는 것은 정상적인 닫힌 고리다.
                    if (chainLen === 1) {
                        const farKey = nextForward
                            ? endpointKey(cand.x1, cand.y1)
                            : endpointKey(cand.x0, cand.y0);
                        const opposite = atHead ? endpointKey(tx, ty) : endpointKey(hx, hy);
                        if (farKey === opposite) continue;
                    }
                    next = idx;
                    break;
                }
                if (next < 0) break;
                used[next] = 1;
                chainLen += 1;
                const cand = segs[next];
                const farX = nextForward ? cand.x1 : cand.x0;
                const farY = nextForward ? cand.y1 : cand.y0;
                if (atHead) {
                    hx = farX;
                    hy = farY;
                } else {
                    tx = farX;
                    ty = farY;
                }
            }
        }
        out.push({ x0: hx, y0: hy, x1: tx, y1: ty });
    }
    return out;
}

/**
 * 스칼라 필드에서 `level` 등고선을 추적한다.
 *
 * @param field  row-major 필드. `field[gy*cols+gx]`, 길이 cols*rows
 * @param cols   열 수
 * @param rows   행 수
 * @param level  등고선 값 (기본 0)
 * @param chain  true 면 끝점을 공유하는 선분을 폴리라인으로 합친다 (기본 true)
 * @returns       그리드 인덱스 공간 좌표의 선분 목록. 셀은 row-major 순으로 순회한다.
 *
 * Saddle(5, 10) 해석: 셀 중심을 항상 **낮은 쪽(등고선 밖)** 으로 고정한다.
 * 즉 case 5 는 모서리 B 와 D 를 각각 독립된 조각으로 떼어내고, case 10 은
 * 모서리 A 와 C 를 그렇게 떼어낸다. 데이터에 따라 갈리는 비대칭 해석
 * (asymptotic/center decider)을 쓰지 않는 이유는 결과가 필드 미묘한 변화에
 * 의존해 자국(stipple) 문양으로 출현해 국경선이 그을리게 되기 때문이다.
 * 항상 같은 규칙을 쓰면 국경 형태가 예측 가능하고 국경선이 깨지지 않는다.
 */
export function traceIsoContours(
    field: Float32Array,
    cols: number,
    rows: number,
    level = 0,
    chain = true,
): ContourSegment[] {
    const width = Number.isFinite(cols) ? Math.floor(cols) : 0;
    const height = Number.isFinite(rows) ? Math.floor(rows) : 0;
    if (width < 2 || height < 2) return [];
    if (!field || typeof field.length !== 'number') return [];

    // 셀마다 새로 만들지 않는 교점 버퍼 4개(상/우/하/좌 모서리).
    const tp = new Float64Array(2);
    const rp = new Float64Array(2);
    const bp = new Float64Array(2);
    const lp = new Float64Array(2);
    const segs: ContourSegment[] = [];
    const emit = (a: Float64Array, b: Float64Array): void => {
        segs.push({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
    };

    for (let gy = 0; gy < height - 1; gy++) {
        const rowA = gy * width;
        const rowB = (gy + 1) * width;
        for (let gx = 0; gx < width - 1; gx++) {
            // 모서리 이름은 반시계 방향(행을 아래로 두면 시계)으로 붙인다.
            const a = sampleAt(field, rowA + gx, level); // (gx,   gy)
            const b = sampleAt(field, rowA + gx + 1, level); // (gx+1, gy)
            const c = sampleAt(field, rowB + gx + 1, level); // (gx+1, gy+1)
            const d = sampleAt(field, rowB + gx, level); // (gx,   gy+1)
            const inA = a > level;
            const inB = b > level;
            const inC = c > level;
            const inD = d > level;
            const idx = (inA ? 8 : 0) | (inB ? 4 : 0) | (inC ? 2 : 0) | (inD ? 1 : 0);
            if (idx === 0 || idx === 15) continue;

            const hasT = writeEdgePoint(gx, gy, gx + 1, gy, a, b, level, tp);
            const hasR = writeEdgePoint(gx + 1, gy, gx + 1, gy + 1, b, c, level, rp);
            const hasB = writeEdgePoint(gx, gy + 1, gx + 1, gy + 1, d, c, level, bp);
            const hasL = writeEdgePoint(gx, gy, gx, gy + 1, a, d, level, lp);

            switch (idx) {
                case 1: // D
                    if (hasL && hasB) emit(lp, bp);
                    break;
                case 2: // C
                    if (hasR && hasB) emit(rp, bp);
                    break;
                case 3: // C + D
                    if (hasR && hasL) emit(rp, lp);
                    break;
                case 4: // B
                    if (hasT && hasR) emit(tp, rp);
                    break;
                case 5: // B + D — saddle, 중심은 낮은 쪽 고정 → B 와 D 를 분리
                    if (hasT && hasR) emit(tp, rp);
                    if (hasL && hasB) emit(lp, bp);
                    break;
                case 6: // B + C
                    if (hasT && hasB) emit(tp, bp);
                    break;
                case 7: // B + C + D
                    if (hasT && hasL) emit(tp, lp);
                    break;
                case 8: // A
                    if (hasL && hasT) emit(lp, tp);
                    break;
                case 9: // A + D
                    if (hasB && hasT) emit(bp, tp);
                    break;
                case 10: // A + C — saddle, 중심은 낮은 쪽 고정 → A 와 C 를 분리
                    if (hasL && hasT) emit(lp, tp);
                    if (hasR && hasB) emit(rp, bp);
                    break;
                case 11: // A + C + D
                    if (hasR && hasT) emit(rp, tp);
                    break;
                case 12: // A + B
                    if (hasL && hasR) emit(lp, rp);
                    break;
                case 13: // A + B + D
                    if (hasB && hasR) emit(bp, rp);
                    break;
                case 14: // A + B + C
                    if (hasB && hasL) emit(bp, lp);
                    break;
                default:
                    break;
            }
        }
    }

    return chain ? joinChains(segs) : segs;
}
