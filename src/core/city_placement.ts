/**
 * [481-500] 정규 지도 좌표 위 도시 배치 완화기 — relaxCityPlacement
 *
 * 목적:
 *   실측 경위도는 AI 생성 지도와 절대로 맞지 않는다. 제품 오너가 직접
 *   "실측 좌표에 집착하지 말고 유연하게, 도시를 널리 퍼뜨리고 해안 가까이에
 *   배치하라"고 지시했으므로 좌표의 절대 정확도는 포기한다.
 *   artwork 에서 유일하게 신뢰할 수 있는 지형 특징은 **해안선**(육지/바다 마스크에서
 *   유도된 경계) 이므로, "해안 근접"은 정의 가능하고 검증 가능하지만
 *   "경도 116도"는 그렇지 않다.
 *
 * 제약 우선순위 (이 순서가 곧 알고리즘의 설계 근거다):
 *   1. isLand  — 도시가 바다에 남으면 안 된다. (이동 중 바다에 닿으면 직전 유효 위치로 되돌린다)
 *   2. maxMove  — 원본 대비 총 이동 거리를 하드 클램프한다.
 *   3. 0..1 박스 — 좌표는 항상 정규화 범위 안에 있어야 한다.
 *
 * 결정론: 지도 로드 시 1회만 돌기 때문에 새로고침마다 지도가 흔들리면 안 된다.
 *         Math.random 을 단 한 번도 쓰지 않고, 순회 순서도 고정한다.
 */

/** 정규화(0~1) 좌표의 도시 하나. */
export interface PlacementCity {
    id: string;
    x: number; // normalized 0..1
    y: number;
}

/** 도시 배치 완화 옵션. */
export interface PlacementOptions {
    /** 지형 판정: 정규화 좌표가 육지면 true. */
    isLand: (x: number, y: number) => boolean;
    /** 최대 이동 거리 (정규화 단위). */
    maxMove?: number;
    /** 도시 사이 최소 간격. */
    minGap?: number;
    /** 해안 방향으로 밀어내는 강도 (0~1). 0 이면 밀지 않고 간격만 지킨다. */
    coastBias?: number;
    /** 반복 횟수. */
    iterations?: number;
}

/** 도시 배치 결과. */
export interface PlacementResult {
    positions: Map<string, { x: number; y: number }>;
    /** 실제 이동 거리 (정규화). */
    moved: Map<string, number>;
    /** land=false 인 좌표에 남은 도시 id — 없어야 정상. */
    offLand: string[];
}

const DEFAULT_MAX_MOVE = 0.12;
const DEFAULT_MIN_GAP = 0.04;
const DEFAULT_COAST_BIAS = 0.5;
const DEFAULT_ITERATIONS = 240;

/** 해안 법선 탐침 방향 수. 홀수/짝수 편향이 없도록 16으로 고정. */
const COAST_DIRECTIONS = 16;
/**
 * 탐침을 일정 간격(기하급수가 아니라 균등)으로 전진시킨다.
 * 기하급수 표본을 쓰면 "가까운 쪽"만 세밀하게 재서 반대편 대각선 방향이
 * 오탐하는 경우가 생겨서, 도시가 해안선에 닿았는데도 비스듬히 밀려난다.
 * 균등 전진은 실제 "거리장(distance-to-water)의 음의 기울기"에 수렴한다.
 */
const COAST_PROBE_STEP = 0.003;
const COAST_PROBE_STEPS = 150;
/** 1위 탐침 거리 이내로 거의 동률인 방향만 함께 평균내 해안선 요동에 대응한다. */
const COAST_SMOOTH_RATIO = 1.05;
/** 육지 복원(이분 탐색) 반복 횟수. */
const LAND_BISECT_STEPS = 14;
/** "같은 점"으로 간주하는 거리. */
const COINCIDENT_EPS = 1e-6;
/** 완전 중첩 도시를 황금각으로 흩뜨릴 때의 간격 배수. */
const COINCIDENT_RADIUS_RATIO = 0.75;
/** 황금각 — 137.5°. 균등 전진 배치가 항상 겹치기 쉬운 방향을 골라준다. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
/**
 * 마지막 간격 다듬기 반복 수.
 * 해안 밀기는 도시별 한계에서 멈추지 않아 간격 완화를 상쇄하므로 minGap 을
 * 1% 남짓 밑돈다. 해안 이동만 끄고 간격 완화만 더 돌려 그 잔여를 회수한다.
 * 각 도시는 이미 해안선에 붙어 있으므로 밀리는 거리도 잔여 결손만큼이다.
 */
const POLISH_ITERATIONS = 240;

interface Vec {
    x: number;
    y: number;
}

function clampUnit(value: number, fallback: number): number {
    if (!Number.isFinite(value)) return fallback;
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

function sanitizeNonNegative(value: number | undefined, fallback: number): number {
    if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
    return value;
}

function sanitizeIterations(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) return DEFAULT_ITERATIONS;
    const n = Math.floor(value);
    return n < 0 ? 0 : n;
}

/** 한 방향으로 전진하며 처음 물에 닿는 거리. 끝까지 육지면 Infinity. */
function waterOnset(
    x: number,
    y: number,
    dirX: number,
    dirY: number,
    isLand: (x: number, y: number) => boolean,
): number {
    for (let step = 1; step <= COAST_PROBE_STEPS; step++) {
        const reach = step * COAST_PROBE_STEP;
        if (!isLand(x + dirX * reach, y + dirY * reach)) return reach;
    }
    return Number.POSITIVE_INFINITY;
}

/**
 * 도시 위치에서 16방향으로 짧게 전진하며 "물 시작점"이 가장 빠른 방향을 찾는다.
 * 그 방향이 해안 법선(land distance field 의 음의 기울기)이다.
 * 내륙이라 어느 방향으로도 물이 없으면 (0,0) 을 돌려 해안 이동을 건너뛴다.
 */
function probeCoastDirection(
    x: number,
    y: number,
    isLand: (x: number, y: number) => boolean,
): Vec {
    let best = Number.POSITIVE_INFINITY;
    for (let k = 0; k < COAST_DIRECTIONS; k++) {
        const angle = (2 * Math.PI * k) / COAST_DIRECTIONS;
        const onset = waterOnset(x, y, Math.cos(angle), Math.sin(angle), isLand);
        if (onset < best) best = onset;
    }
    if (!Number.isFinite(best)) return { x: 0, y: 0 };

    let sumX = 0;
    let sumY = 0;
    const threshold = best * COAST_SMOOTH_RATIO;
    for (let k = 0; k < COAST_DIRECTIONS; k++) {
        const angle = (2 * Math.PI * k) / COAST_DIRECTIONS;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        if (waterOnset(x, y, dirX, dirY, isLand) > threshold) continue;
        sumX += dirX;
        sumY += dirY;
    }
    const length = Math.hypot(sumX, sumY);
    // 정확히 정반대 두 방향만 잡히는 지협( tombol) 처럼 상쇄되면 방향이 없다.
    if (length === 0) return { x: 0, y: 0 };
    return { x: sumX / length, y: sumY / length };
}

/**
 * 목표점이 바다면 `prev` → `target` 선분에서 가장 먼 육지 지점을 이분 탐색한다.
 * `lo` 는 항상 육지로 확인된 값이므로 반환 좌표는 반드시 land=true 다.
 * prev 조차 land=false 면 더 나은 지점이 없으므로 prev 로 유지한다
 * (입력 자체가 바다에 놓인 도시 → 최종적으로 offLand 로 보고된다).
 */
function stepOntoLand(
    prevX: number,
    prevY: number,
    targetX: number,
    targetY: number,
    isLand: (x: number, y: number) => boolean,
): Vec {
    if (isLand(targetX, targetY)) return { x: targetX, y: targetY };
    if (!isLand(prevX, prevY)) return { x: prevX, y: prevY };

    let lo = 0;
    let hi = 1;
    for (let k = 0; k < LAND_BISECT_STEPS; k++) {
        const mid = (lo + hi) / 2;
        if (isLand(prevX + (targetX - prevX) * mid, prevY + (targetY - prevY) * mid)) lo = mid;
        else hi = mid;
    }
    return { x: prevX + (targetX - prevX) * lo, y: prevY + (targetY - prevY) * lo };
}

/**
 * 하드 제약 3종을 이 순서대로 적용한다.
 *   박스(0~1) → 이동 한도 원반(maxMove) → 육지 복원
 * 앞의 두 단계는 볼록 집합(직사각형/원)이라 보간해도 범위를 벗어나지 않는다.
 * 즉, 육지 복원이 값을 줄이기만 하므로 앞 제약이 깨지지 않는다.
 */
function settle(
    prevX: number,
    prevY: number,
    targetX: number,
    targetY: number,
    originX: number,
    originY: number,
    maxMove: number,
    isLand: (x: number, y: number) => boolean,
): Vec {
    const boxedX = clampUnit(targetX, originX);
    const boxedY = clampUnit(targetY, originY);
    const dx = boxedX - originX;
    const dy = boxedY - originY;
    const dist = Math.hypot(dx, dy);
    if (dist > maxMove) {
        // maxMove 가 0 이면 dist>0 인 모든 경우 원점으로 정확히 붙는다.
        const limitedX = originX + (dx / dist) * maxMove;
        const limitedY = originY + (dy / dist) * maxMove;
        return stepOntoLand(prevX, prevY, limitedX, limitedY, isLand);
    }
    return stepOntoLand(prevX, prevY, boxedX, boxedY, isLand);
}

/**
 * 도시 좌표를 최대한 넓게, 최대한 해안 근처로 재배치한다.
 *
 * - 해안 방향: 16방향 탐침으로 물 시작점이 가장 빠른 방향을 찾아 그 법선 쪽으로
 *   `maxMove × coastBias / iterations` 만큼 매 반복마다 전진시킨다. 육지 제약에
 *   걸리면 그 자리에서 멈추므로 결과적으로 도시가 해안선에 달라붙는다.
 * - 간격 완화: 겹치는 쌍마다 양쪽을 겹친 만큼의 절반씩 동일하게 밀어낸다
 *   (한쪽만 다 밀면 도시가 한쪽으로 쏠린다). Jacobi 방식이라 여러 도시에
 *   동시에 적용해도 안정적으로 풀린다.
 * - 매 반복마다 도시별로 `settle` 을 걸어 isLand / maxMove / 0~1 을 복원한다.
 *
 * minGap 은 maxMove 안에서 기하학적으로 배치 가능한 경우에 보장된다.
 * 간격 확보에 필요한 면적이 maxMove 원반 밖이면 maxMove 가 우선한다
 * (요구사항의 하드 제약 우선순위 2 참조).
 *
 * @param cities 원본 도시 목록. 배열과 객체를 절대 변경하지 않는다.
 * @param options 지형 판정 함수와 완화 파라미터.
 * @returns 최종 좌표, 실제 이동 거리, 육지가 아닌 좌표에 남은 도시 목록.
 */
export function relaxCityPlacement(
    cities: readonly PlacementCity[],
    options: PlacementOptions,
): PlacementResult {
    const isLand = options.isLand;
    const maxMove = sanitizeNonNegative(options.maxMove, DEFAULT_MAX_MOVE);
    const minGap = sanitizeNonNegative(options.minGap, DEFAULT_MIN_GAP);
    const coastBias = clampUnit(
        sanitizeNonNegative(options.coastBias, DEFAULT_COAST_BIAS),
        DEFAULT_COAST_BIAS,
    );
    const iterations = sanitizeIterations(options.iterations);

    const positions = new Map<string, { x: number; y: number }>();
    const moved = new Map<string, number>();
    const count = cities.length;
    if (count === 0) return { positions, moved, offLand: [] };

    // maxMove 원반의 중심은 "단위 박스로 스냅한 원본"이다.
    // 입력 좌표가 0..1 밖이면 두 제약(박스/이동거리)을 동시에 만족시킬 수 없으므로
    // 박스를 우선하고, 이동 거리 기준은 스냅한 값으로 잡는다.
    const ids: string[] = [];
    const originX = new Float64Array(count);
    const originY = new Float64Array(count);
    const curX = new Float64Array(count);
    const curY = new Float64Array(count);
    const nextX = new Float64Array(count);
    const nextY = new Float64Array(count);
    const coastX = new Float64Array(count);
    const coastY = new Float64Array(count);

    for (let i = 0; i < count; i++) {
        const city = cities[i];
        ids.push(city.id);
        const x = clampUnit(city.x, 0.5);
        const y = clampUnit(city.y, 0.5);
        originX[i] = x;
        originY[i] = y;
        curX[i] = x;
        curY[i] = y;
        if (coastBias > 0) {
            const dir = probeCoastDirection(x, y, isLand);
            coastX[i] = dir.x;
            coastY[i] = dir.y;
        }
    }

    // 완전 중첩 도시 사전 분산: 원점이 같은 도시들은 쌍의 축이 없으므로
    // 간격 완화의 힘이 서로 상쇄돼 그대로 남는다. 인덱스에서 만든 황금각
    // 방향으로 한 번 흩어 놓아야 이후 반복이 실제로 작동한다.
    for (let i = 1; i < count; i++) {
        let coincident = false;
        for (let j = 0; j < i; j++) {
            const dx = originX[i] - originX[j];
            const dy = originY[i] - originY[j];
            if (dx * dx + dy * dy <= COINCIDENT_EPS * COINCIDENT_EPS) {
                coincident = true;
                break;
            }
        }
        if (!coincident) continue;
        const angle = i * GOLDEN_ANGLE;
        const radius = minGap * COINCIDENT_RADIUS_RATIO;
        const placed = settle(
            curX[i],
            curY[i],
            curX[i] + Math.cos(angle) * radius,
            curY[i] + Math.sin(angle) * radius,
            originX[i],
            originY[i],
            maxMove,
            isLand,
        );
        curX[i] = placed.x;
        curY[i] = placed.y;
    }

    const coastStep = iterations > 0 ? (maxMove * coastBias) / iterations : 0;
    const totalSteps = iterations + (iterations > 0 ? POLISH_ITERATIONS : 0);

    for (let step = 0; step < totalSteps; step++) {
        for (let i = 0; i < count; i++) {
            nextX[i] = curX[i];
            nextY[i] = curY[i];
        }

        // (1) 간격 완화 — 겹친 만큼의 절반을 양쪽에 동일하게 분배
        for (let i = 0; i < count; i++) {
            for (let j = i + 1; j < count; j++) {
                const dx = curX[i] - curX[j];
                const dy = curY[i] - curY[j];
                const dist = Math.hypot(dx, dy);
                if (dist >= minGap) continue;
                let dirX: number;
                let dirY: number;
                if (dist <= COINCIDENT_EPS) {
                    // 사전 분산 후에도 겹쳤다면(예: 간격이 0) 결정적인 보조 방향 사용
                    const angle = ((i * 5 + j * 3) % COAST_DIRECTIONS) * ((2 * Math.PI) / COAST_DIRECTIONS);
                    dirX = Math.cos(angle);
                    dirY = Math.sin(angle);
                } else {
                    dirX = dx / dist;
                    dirY = dy / dist;
                }
                const push = (minGap - dist) * 0.5;
                nextX[i] += dirX * push;
                nextY[i] += dirY * push;
                nextX[j] -= dirX * push;
                nextY[j] -= dirY * push;
            }
        }

        // (2) 해안 방향 전진 — 밀어내는 요구가 우선이라 간격 완화 뒤에 둔다.
        //     육지 제약이 해안선에서 막아주므로 도시가 자연스럽게 해안에 붙는다.
        if (step < iterations && coastStep > 0) {
            for (let i = 0; i < count; i++) {
                if (coastX[i] === 0 && coastY[i] === 0) continue;
                nextX[i] += coastX[i] * coastStep;
                nextY[i] += coastY[i] * coastStep;
            }
        }

        // (3) 하드 제약 복원
        for (let i = 0; i < count; i++) {
            const placed = settle(
                curX[i],
                curY[i],
                nextX[i],
                nextY[i],
                originX[i],
                originY[i],
                maxMove,
                isLand,
            );
            curX[i] = placed.x;
            curY[i] = placed.y;
        }
    }

    const offLand: string[] = [];
    for (let i = 0; i < count; i++) {
        const id = ids[i];
        const x = curX[i];
        const y = curY[i];
        positions.set(id, { x, y });
        moved.set(id, Math.hypot(x - originX[i], y - originY[i]));
        if (!isLand(x, y)) offLand.push(id);
    }
    return { positions, moved, offLand };
}
