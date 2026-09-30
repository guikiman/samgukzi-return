/**
 * 삼국지리턴 — 고성능 A* 길찾기 및 전장 규칙 엔진
 * 파일: src/core/hex_battle_rules_engine.ts
 *
 * 설계 스펙 준수사항:
 * [Axial Coordinates] → q, r, s 축 좌표계를 활용한 헥사곤 거리 연산
 * [병종/지형 가중치]   → 기병, 보병별 지형 통과 MP Cost 실시간 계산
 * [ZOC 강제 정지]     → 적 유닛 인접 헥스 진입 시 잔여 이동력 소멸 규칙 적용
 * [보급선 연결 검사]   → BFS 기반 수도/거점 연결선 확인 및 단절 플래그 처리
 *
 * Python 원본: src/systems/pathfinding.py → TypeScript 포팅 + 확장
 * (기존 astar_hex_pathfinder.ts는 범용 A*이며, 이 파일은 병종/지형/ZOC/보급선
 *  전장 규칙을 통합한 전용 엔진)
 */

// ============================================================
// 헥스 타일 구조체
// ============================================================

export type TerrainType = 'PLAINS' | 'RIVER' | 'MOUNTAIN' | 'WATER';

/** 헥스 그리드 단일 타일 정보 구조체 */
export interface HexTileInfo {
    q: number;
    r: number;
    /** Axial 좌표계 수식 검증: s = -q - r */
    s: number;
    terrainType: TerrainType;
    /** 고저차 (고원 판별용) */
    elevation: number;
}

export function makeHexTile(q: number, r: number, terrainType: TerrainType = 'PLAINS', elevation = 0): HexTileInfo {
    return { q, r, s: -q - r, terrainType, elevation };
}

// ============================================================
// 병종 / 지형 가중치 테이블
// ============================================================

export type UnitType = 'HEAVY_CAVALRY' | 'SPECIAL_CAVALRY' | 'SPEARMAN' | 'LANCE_CAVALRY';

/** 기획서 기준 병종별 이동 비용 배율 (Cost Multiplier) */
const UNIT_MP_RATES: Record<UnitType, number> = {
    HEAVY_CAVALRY: 1.0,   // 중기병 (기마군단): 기본 평지에서 가장 효율적
    SPECIAL_CAVALRY: 1.5, // 특수부대 (맹룡무도 등): 신속한 기동
    SPEARMAN: 1.8,        // 창군 (무장보병): 방어 중심, 이동력 저하
    LANCE_CAVALRY: 2.5,   // 장창기병: 회전 반경 한계로 페널티 높음
};

/** 지형별 기본 이동 페널티 비용 */
const TERRAIN_COSTS: Record<TerrainType, number> = {
    PLAINS: 1.0,     // 일반 땅
    RIVER: 1.4,      // 강/고원
    MOUNTAIN: 1.8,   // 산지
    WATER: 999.0,    // 통과 불가 깊은 물 (inf 대체)
};

const IMPASSABLE_COST = 500.0;

// ============================================================
// 길찾기 및 전장 물리 엔진
// ============================================================

type HexKey = string;
const key = (q: number, r: number): HexKey => `${q},${r}`;

export class HexBattleRulesEngine {
    /**
     * 병종 가중치와 지형 속성을 결합한 단일 타일 통과 비용 계산.
     * 고저차 및 경사지 보정 규칙 통합.
     */
    computeMoveCost(tile: HexTileInfo, unitType: UnitType): number {
        const mpRate = UNIT_MP_RATES[unitType] ?? 1.5;
        const baseCost = TERRAIN_COSTS[tile.terrainType] ?? 1.0;

        // 산악/경사지 가중치 심화
        const slopePenalty = (tile.elevation > 10 || tile.terrainType === 'MOUNTAIN') ? 1.5 : 1.0;
        return Math.round(baseCost * mpRate * slopePenalty * 1000) / 1000;
    }

    /** Axial 좌표계 기준 두 헥스 타일 간의 거리 (A* 휴리스틱용) */
    hexDistance(aq: number, ar: number, bq: number, br: number): number {
        return (Math.abs(aq - bq) + Math.abs(ar - br) + Math.abs(aq + ar - bq - br)) / 2;
    }

    /** 헥사곤 축 좌표계 기준 인접한 6방향 이웃 타일 좌표 반환 */
    getNeighbors(q: number, r: number): Array<[number, number]> {
        return [
            [q + 1, r], [q + 1, r - 1], [q, r - 1],
            [q - 1, r], [q - 1, r + 1], [q, r + 1],
        ];
    }

    /**
     * [고성능 60fps A* 알고리즘]
     * ZOC 강제 정지 제약 조건을 실시간 계산에 포함하여 최적 전술 경로 도출 (< 5ms).
     *
     * @param start      시작 좌표 [q, r]
     * @param goal       목표 좌표 [q, r]
     * @param unitType   병종
     * @param gridMap    지도 (좌표 → 타일 정보)
     * @param enemyPositions 적 유닛 점유 좌표 집합 (ZOC 판정 근거)
     * @returns 최적 경로 배열 (시작 포함). 경로가 없으면 빈 배열
     */
    searchPath(
        start: [number, number],
        goal: [number, number],
        unitType: UnitType,
        gridMap: Map<HexKey, HexTileInfo>,
        enemyPositions: Set<HexKey>,
    ): Array<[number, number]> {
        const startKey = key(start[0], start[1]);
        const goalKey = key(goal[0], goal[1]);
        if (startKey === goalKey) return [start];

        // 우선순위 큐: 이진 최소 힙 (push/pop O(log n) — 60fps 대규모 맵 대응)
        const heapQ: number[] = [];
        const heapR: number[] = [];
        const heapF: number[] = [];
        const heapPush = (f: number, q: number, r: number): void => {
            let i = heapF.length;
            heapF.push(f); heapQ.push(q); heapR.push(r);
            while (i > 0) {
                const parent = (i - 1) >> 1;
                if (heapF[parent] <= heapF[i]) break;
                [heapF[parent], heapF[i]] = [heapF[i], heapF[parent]];
                [heapQ[parent], heapQ[i]] = [heapQ[i], heapQ[parent]];
                [heapR[parent], heapR[i]] = [heapR[i], heapR[parent]];
                i = parent;
            }
        };
        const heapPop = (): { f: number; q: number; r: number } | undefined => {
            const n = heapF.length;
            if (n === 0) return undefined;
            const top = { f: heapF[0], q: heapQ[0], r: heapR[0] };
            const lastF = heapF.pop()!, lastQ = heapQ.pop()!, lastR = heapR.pop()!;
            if (n > 1) {
                heapF[0] = lastF; heapQ[0] = lastQ; heapR[0] = lastR;
                let i = 0;
                for (;;) {
                    const l = i * 2 + 1, rgt = i * 2 + 2;
                    let smallest = i;
                    if (l < heapF.length && heapF[l] < heapF[smallest]) smallest = l;
                    if (rgt < heapF.length && heapF[rgt] < heapF[smallest]) smallest = rgt;
                    if (smallest === i) break;
                    [heapF[smallest], heapF[i]] = [heapF[i], heapF[smallest]];
                    [heapQ[smallest], heapQ[i]] = [heapQ[i], heapQ[smallest]];
                    [heapR[smallest], heapR[i]] = [heapR[i], heapR[smallest]];
                    i = smallest;
                }
            }
            return top;
        };

        const cameFrom = new Map<HexKey, HexKey>();
        const gScore = new Map<HexKey, number>([[startKey, 0]]);
        heapPush(this.hexDistance(start[0], start[1], goal[0], goal[1]), start[0], start[1]);

        while (heapQ.length > 0) {
            const current = heapPop()!;
            const currentKey = key(current.q, current.r);

            if (currentKey === goalKey) {
                // 역추적을 통한 최종 최적 경로 배열 복원
                const path: Array<[number, number]> = [];
                let cursor: HexKey | undefined = currentKey;
                while (cursor && cursor !== startKey) {
                    const [cq, cr] = cursor.split(',').map(Number);
                    path.push([cq, cr]);
                    cursor = cameFrom.get(cursor);
                }
                path.push(start);
                return path.reverse();
            }

            // 🛑 ZOC 강제 정지 검증: 현재 타일이 적 유닛의 인접 헥스(통제 영역)라면
            // 잔여 이동력 소멸 — 해당 노드로부터 더 이상의 전진 탐색 불가.
            // (출발지는 ZOC 탈출 가능)
            if (currentKey !== startKey && this.isInZOC(current.q, current.r, enemyPositions)) {
                continue;
            }

            // 6방향 인접 이웃 타일 확장 탐색
            const currentG = gScore.get(currentKey) ?? Infinity;
            for (const [nq, nr] of this.getNeighbors(current.q, current.r)) {
                const nKey = key(nq, nr);
                const tileInfo = gridMap.get(nKey);
                if (!tileInfo) continue;

                const moveCost = this.computeMoveCost(tileInfo, unitType);
                // 통과 불가 지형 차단
                if (moveCost >= IMPASSABLE_COST) continue;

                const tentativeG = currentG + moveCost;
                if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
                    cameFrom.set(nKey, currentKey);
                    gScore.set(nKey, tentativeG);
                    heapPush(tentativeG + this.hexDistance(nq, nr, goal[0], goal[1]), nq, nr);
                }
            }
        }

        return []; // 경로가 막혀 존재하지 않는 경우 빈 배열 리턴
    }

    /** 특정 헥스가 적 유닛의 ZOC(통제 영역) 안에 있는지 판정 */
    isInZOC(q: number, r: number, enemyPositions: Set<HexKey>): boolean {
        for (const [nq, nr] of this.getNeighbors(q, r)) {
            if (enemyPositions.has(key(nq, nr))) return true;
        }
        return false;
    }

    /**
     * [BFS 기반 실시간 보급선 검사 매니저]
     * 아군 유닛 위치에서 수도/보급거점까지 적군에게 차단당하지 않는
     * 연결 경로가 있는지 스캔합니다.
     *
     * @returns true = 보급선 유효 / false = 포위되어 보급선 단절 (is_supplied = false)
     */
    calculateSupplyLine(
        unitPos: [number, number],
        capitalPos: [number, number],
        gridMap: Map<HexKey, HexTileInfo>,
        enemyPositions: Set<HexKey>,
    ): boolean {
        const unitKey = key(unitPos[0], unitPos[1]);
        const capitalKey = key(capitalPos[0], capitalPos[1]);
        if (unitKey === capitalKey) return true;

        const visited = new Set<HexKey>([unitKey]);
        const queue: Array<[number, number]> = [unitPos];

        while (queue.length > 0) {
            const [cq, cr] = queue.shift()!;
            if (key(cq, cr) === capitalKey) return true; // 보급선이 유효하게 연결됨

            for (const [nq, nr] of this.getNeighbors(cq, cr)) {
                const nKey = key(nq, nr);
                // 지도 내부에 있고, 적 유닛에게 차단당하지 않은 헥스만 전진 가능
                if (gridMap.has(nKey) && !visited.has(nKey) && !enemyPositions.has(nKey)) {
                    visited.add(nKey);
                    queue.push([nq, nr]);
                }
            }
        }

        return false; // 아군 유닛이 적군에게 포위되어 보급선이 끊김
    }
}
