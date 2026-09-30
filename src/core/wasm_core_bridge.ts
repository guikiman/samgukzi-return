/**
 * 삼국지리턴 — WebAssembly 고속 AI 이식 데이터 브리지
 * 파일: src/core/wasm_core_bridge.ts
 *
 * [201] Wasm 가속 길찾기 및 대미지 바인딩 인터페이스
 *
 * ── 설계 원칙 ──
 *   - JS GC/힙을 우회: 모든 데이터는 ArrayBuffer → Wasm 선형 메모리 직접 매핑
 *   - 고정 배열(Fixed Array) 직렬화: 오브젝트 필드 대신 평탄화된 Float32Array/Int32Array
 *   - 호출당 메모리 할당/해제는 Wasm allocator에 위임 (exported malloc/free)
 *   - 결과는 Wasm 메모리에서 직접 읽어 TypedArray로 반환
 *
 * ── Wasm 메모리 레이아웃 ──
 *
 *   [0x0000 ── 0x03FF] : 스택/전역
 *   [0x0400 ── 0x1FFF] : 입력 버퍼 (그리드, 유닛 스탯)
 *   [0x2000 ── 0x3FFF] : 출력 버퍼 (경로, 대미지 결과)
 *   [0x4000 ── ...   ] : 동적 할당 영역 (malloc)
 */

import { PRNG } from './network_sync_manager.js';

// ============================================================
// [0] 타입 정의
// ============================================================

/** Wasm 익스포트 함수 시그니처 */
export interface WasmExports {
    /** 메모리 할당 (bytes) → 포인터 */
    malloc: (size: number) => number;
    /** 메모리 해제 */
    free: (ptr: number) => void;
    /** A* 길찾기: (gridPtr, gridW, gridH, startX, startY, endX, endY, outPtr) → 경로 길이 */
    astar_pathfind: (gridPtr: number, gridW: number, gridH: number, startX: number, startY: number, endX: number, endY: number, outPtr: number) => number;
    /** 대미지 계산: (attackerPtr, defenderPtr, terrainType, weather) → 대미지 */
    calc_damage: (attackerPtr: number, defenderPtr: number, terrainType: number, weather: number) => number;
    /** 전투 시뮬레이션: (attackerPtr, defenderPtr, rounds) → 결과 ptr */
    simulate_combat: (attackerPtr: number, defenderPtr: number, rounds: number) => number;
    /** 체크섬 계산: (dataPtr, length) → 32bit 체크섬 */
    checksum: (dataPtr: number, length: number) => number;
}

/** Wasm 모듈 로드 결과 */
export interface WasmModuleResult {
    instance: WebAssembly.Instance;
    memory: WebAssembly.Memory;
    exports: WasmExports;
}

/** 그리드 셀 데이터 (평탄화) */
export interface GridCellData {
    readonly height: number;
    readonly terrainType: number;  // 0=plain, 1=forest, 2=mountain, 3=river, 4=swamp, 5=road
    readonly isBlocked: number;    // 0 or 1
    readonly moveCost: number;     // 이동 비용
}

/** 유닛 스탯 (평탄화) */
export interface UnitStats {
    readonly attack: number;
    readonly defense: number;
    readonly hp: number;
    readonly maxHp: number;
    readonly morale: number;
    readonly troopCount: number;
    readonly troopType: number;   // 0=infantry, 1=cavalry, 2=archer, 3=siege
    readonly leadership: number;
    readonly experience: number;
}

/** 경로 결과 */
export interface PathResult {
    readonly path: readonly { readonly x: number; readonly y: number }[];
    readonly length: number;
    readonly totalCost: number;
}

/** 대미지 계산 결과 */
export interface DamageResult {
    readonly damage: number;
    readonly isCritical: boolean;
    readonly isHit: boolean;
    readonly moraleDamage: number;
}

// ============================================================
// [1] WasmCoreBridge
// ============================================================

/**
 * WasmCoreBridge — JS ↔ Wasm 고속 데이터 브리지
 *
 * 설계 원칙:
 *   - JS GC/힙을 완전히 우회: 모든 데이터는 ArrayBuffer → Wasm 선형 메모리 직접 매핑
 *   - 직렬화된 고정 배열(Fixed Array)만 사용: 오브젝트 직렬화 오버헤드 제로
 *   - 메모리 할당/해제는 Wasm의 exported malloc/free 사용
 *   - TypedArray 뷰를 통해 0-copy 읽기/쓰기
 *
 * 메모리 레이아웃:
 *   [0x0000 ── 0x03FF] : Wasm 스택/전역
 *   [0x0400 ── 0x1FFF] : 고정 입력 버퍼 (그리드, 유닛 스탯)
 *   [0x2000 ── 0x3FFF] : 고정 출력 버퍼 (경로, 결과)
 *   [0x4000 ── ...   ] : 동적 할당 (malloc)
 */
export class WasmCoreBridge {
    private instance: WebAssembly.Instance | null = null;
    private memory: WebAssembly.Memory | null = null;
    private exports: WasmExports | null = null;
    private _ready = false;

    // 고정 버퍼 오프셋 (Wasm 측과 동기화)
    private static readonly INPUT_GRID_OFFSET = 0x0400;
    private static readonly INPUT_UNIT_OFFSET = 0x1000;
    private static readonly OUTPUT_PATH_OFFSET = 0x2000;
    private static readonly OUTPUT_RESULT_OFFSET = 0x3000;
    private static readonly MAX_GRID_CELLS = 256 * 256;  // 65,536 셀
    private static readonly MAX_PATH_LENGTH = 1024;

    // ============================================================
    // Wasm 로드 및 초기화
    // ============================================================

    /**
     * Wasm 모듈 로드 및 인스턴스화
     *
     * @param wasmUrl  .wasm 파일 URL
     * @param imports  Wasm 임포트 객체 (옵션)
     */
    async load(wasmUrl: string, imports: WebAssembly.Imports = {}): Promise<boolean> {
        try {
            const response = await fetch(wasmUrl);
            const bytes = await response.arrayBuffer();
            const module = await WebAssembly.compile(bytes);
            const memory = new WebAssembly.Memory({ initial: 64, maximum: 256 }); // 4MB ~ 16MB

            const fullImports: WebAssembly.Imports = {
                env: {
                    memory,
                    abort: (_msg: number, _file: number, _line: number, _col: number) => {
                        throw new Error('[WasmCoreBridge] Wasm aborted');
                    },
                    ...((imports.env ?? {}) as Record<string, WebAssembly.ImportValue>),
                },
                ...imports,
            };

            this.instance = await WebAssembly.instantiate(module, fullImports);
            this.memory = memory;
            this.exports = this.instance.exports as unknown as WasmExports;
            this._ready = true;
            return true;
        } catch (err) {
            console.error('[WasmCoreBridge] Failed to load Wasm module:', err);
            return false;
        }
    }

    get ready(): boolean { return this._ready; }

    // ============================================================
    // 저수준 메모리 매핑
    // ============================================================

    /**
     * Wasm 선형 메모리에 버퍼 할당
     *
     * @param size  할당할 바이트 수
     * @returns     Wasm 메모리 포인터 (0 = 실패)
     */
    allocateBuffer(size: number): number {
        if (!this.exports) return 0;
        try {
            return this.exports.malloc(size);
        } catch (err) {
            console.error('[WasmCoreBridge] malloc failed:', err);
            return 0;
        }
    }

    /**
     * 할당된 Wasm 메모리 해제
     */
    freeBuffer(ptr: number): void {
        if (!this.exports) return;
        try {
            this.exports.free(ptr);
        } catch (err) {
            console.error('[WasmCoreBridge] free failed:', err);
        }
    }

    // ============================================================
    // 데이터 전송 (JS → Wasm)
    // ============================================================

    /**
     * Float32Array 데이터를 Wasm 메모리에 직접 복사
     *
     * @param data   JS Float32Array
     * @param offset Wasm 메모리 오프셋
     */
    writeF32Array(data: Float32Array, offset: number): void {
        if (!this.memory) return;
        const view = new Float32Array(this.memory.buffer, offset, data.length);
        view.set(data);
    }

    /**
     * Int32Array 데이터를 Wasm 메모리에 직접 복사
     */
    writeI32Array(data: Int32Array, offset: number): void {
        if (!this.memory) return;
        const view = new Int32Array(this.memory.buffer, offset, data.length);
        view.set(data);
    }

    /**
     * Uint8Array 데이터를 Wasm 메모리에 직접 복사
     */
    writeU8Array(data: Uint8Array, offset: number): void {
        if (!this.memory) return;
        const view = new Uint8Array(this.memory.buffer, offset, data.length);
        view.set(data);
    }

    // ============================================================
    // 데이터 읽기 (Wasm → JS)
    // ============================================================

    /**
     * Wasm 메모리에서 Float32Array 읽기
     */
    readF32Array(offset: number, length: number): Float32Array {
        if (!this.memory) return new Float32Array(0);
        return new Float32Array(this.memory.buffer, offset, length);
    }

    /**
     * Wasm 메모리에서 Int32Array 읽기
     */
    readI32Array(offset: number, length: number): Int32Array {
        if (!this.memory) return new Int32Array(0);
        return new Int32Array(this.memory.buffer, offset, length);
    }

    /**
     * Wasm 메모리에서 Uint8Array 읽기
     */
    readU8Array(offset: number, length: number): Uint8Array {
        if (!this.memory) return new Uint8Array(0);
        return new Uint8Array(this.memory.buffer, offset, length);
    }

    /**
     * Wasm 메모리에서 단일 Int32 읽기
     */
    readI32(offset: number): number {
        if (!this.memory) return 0;
        return new Int32Array(this.memory.buffer, offset, 1)[0];
    }

    /**
     * Wasm 메모리에서 단일 Float32 읽기
     */
    readF32(offset: number): number {
        if (!this.memory) return 0;
        return new Float32Array(this.memory.buffer, offset, 1)[0];
    }

    // ============================================================
    // 그리드 데이터 직렬화 (JS Object → Flat Array)
    // ============================================================

    /**
     * GridCellData[] → 평탄화 Float32Array 변환
     *
     * 각 셀 = [height, terrainType, isBlocked, moveCost] (4 floats)
     * 총 길이 = cells.length × 4
     */
    serializeGrid(cells: readonly GridCellData[]): Float32Array {
        const flat = new Float32Array(cells.length * 4);
        for (let i = 0; i < cells.length; i++) {
            const c = cells[i];
            flat[i * 4 + 0] = c.height;
            flat[i * 4 + 1] = c.terrainType;
            flat[i * 4 + 2] = c.isBlocked;
            flat[i * 4 + 3] = c.moveCost;
        }
        return flat;
    }

    /**
     * 유닛 스탯 → 평탄화 Float32Array (8 floats)
     *
     * [attack, defense, hp, maxHp, morale, troopCount, troopType, leadership, experience]
     */
    serializeUnitStats(stats: UnitStats): Float32Array {
        return new Float32Array([
            stats.attack,
            stats.defense,
            stats.hp,
            stats.maxHp,
            stats.morale,
            stats.troopCount,
            stats.troopType,
            stats.leadership,
            stats.experience,
        ]);
    }

    // ============================================================
    // Wasm 함수 호출
    // ============================================================

    /**
     * Wasm A* 길찾기 호출
     *
     * @param gridCells  평탄화 그리드 데이터 (GridCellData[] → serializeGrid)
     * @param gridW      그리드 너비
     * @param gridH      그리드 높이
     * @param startX     시작 X
     * @param startY     시작 Y
     * @param endX       목표 X
     * @param endY       목표 Y
     * @returns          경로 결과 (경로 없으면 length=0)
     */
    callPathfinding(
        gridCells: Float32Array,
        gridW: number,
        gridH: number,
        startX: number,
        startY: number,
        endX: number,
        endY: number,
    ): PathResult {
        if (!this.exports || !this.memory) {
            return this.fallbackPathfinding(gridCells, gridW, gridH, startX, startY, endX, endY);
        }

        try {
            // 1. 그리드 데이터 → 고정 입력 버퍼에 복사
            const gridBytes = gridCells.byteLength;
            const gridView = new Uint8Array(gridCells.buffer, gridCells.byteOffset, gridBytes);
            this.writeU8Array(gridView, WasmCoreBridge.INPUT_GRID_OFFSET);

            // 2. Wasm A* 호출
            const pathLen = this.exports.astar_pathfind(
                WasmCoreBridge.INPUT_GRID_OFFSET,
                gridW,
                gridH,
                startX,
                startY,
                endX,
                endY,
                WasmCoreBridge.OUTPUT_PATH_OFFSET,
            );

            if (pathLen <= 0) {
                return { path: [], length: 0, totalCost: 0 };
            }

            // 3. 결과 읽기: [x0, y0, x1, y1, ..., cost]
            const outView = this.readI32Array(
                WasmCoreBridge.OUTPUT_PATH_OFFSET,
                pathLen * 2 + 1,
            );
            const path: { x: number; y: number }[] = [];
            for (let i = 0; i < pathLen; i++) {
                path.push({ x: outView[i * 2], y: outView[i * 2 + 1] });
            }
            const totalCost = outView[pathLen * 2];

            return { path, length: pathLen, totalCost };
        } catch (err) {
            console.error('[WasmCoreBridge] astar_pathfind failed, falling back to JS:', err);
            return this.fallbackPathfinding(gridCells, gridW, gridH, startX, startY, endX, endY);
        }
    }

    /**
     * Wasm 대미지 계산 호출
     *
     * @param attackerStats  공격자 스탯 (평탄화 Float32Array, 9 floats)
     * @param defenderStats  방어자 스탯 (평탄화 Float32Array, 9 floats)
     * @param terrainType    지형 타입 (0=평지, 1=숲, 2=산, 3=강, 4=늪, 5=도로)
     * @param weather        기상 (0=맑음, 1=비, 2=눈, 3=폭풍)
     * @returns              대미지 결과
     */
    callDamageCalc(
        attackerStats: Float32Array,
        defenderStats: Float32Array,
        terrainType: number,
        weather: number,
    ): DamageResult {
        if (!this.exports || !this.memory) {
            return this.fallbackDamageCalc(attackerStats, defenderStats, terrainType, weather);
        }

        try {
            // 1. 공격자 스탯 → 입력 버퍼
            const atkBytes = new Uint8Array(attackerStats.buffer, attackerStats.byteOffset, attackerStats.byteLength);
            this.writeU8Array(atkBytes, WasmCoreBridge.INPUT_UNIT_OFFSET);

            // 2. 방어자 스탯 → 입력 버퍼 + 64바이트
            const defBytes = new Uint8Array(defenderStats.buffer, defenderStats.byteOffset, defenderStats.byteLength);
            this.writeU8Array(defBytes, WasmCoreBridge.INPUT_UNIT_OFFSET + 64);

            // 3. Wasm 대미지 계산 호출
            const resultPtr = this.exports.calc_damage(
                WasmCoreBridge.INPUT_UNIT_OFFSET,
                WasmCoreBridge.INPUT_UNIT_OFFSET + 64,
                terrainType,
                weather,
            );

            // 4. 결과 읽기: [damage(f32), isCritical(f32), isHit(f32), moraleDamage(f32)]
            const result = this.readF32Array(resultPtr, 4);
            return {
                damage: Math.round(result[0]),
                isCritical: result[1] > 0.5,
                isHit: result[2] > 0.5,
                moraleDamage: Math.round(result[3]),
            };
        } catch (err) {
            console.error('[WasmCoreBridge] calc_damage failed, falling back to JS:', err);
            return this.fallbackDamageCalc(attackerStats, defenderStats, terrainType, weather);
        }
    }

    /**
     * Wasm 전투 시뮬레이션 호출 (다회전)
     *
     * @param attackerStats  공격자 스탯
     * @param defenderStats  방어자 스탯
     * @param rounds         시뮬레이션할 턴 수
     * @returns              누적 대미지 결과
     */
    callCombatSim(
        attackerStats: Float32Array,
        defenderStats: Float32Array,
        rounds: number,
    ): { totalDamage: number; totalMoraleDamage: number; roundsSimulated: number } {
        if (!this.exports || !this.memory) {
            return { totalDamage: 0, totalMoraleDamage: 0, roundsSimulated: 0 };
        }

        try {
            const atkBytes = new Uint8Array(attackerStats.buffer, attackerStats.byteOffset, attackerStats.byteLength);
            const defBytes = new Uint8Array(defenderStats.buffer, defenderStats.byteOffset, defenderStats.byteLength);
            this.writeU8Array(atkBytes, WasmCoreBridge.INPUT_UNIT_OFFSET);
            this.writeU8Array(defBytes, WasmCoreBridge.INPUT_UNIT_OFFSET + 64);

            const resultPtr = this.exports.simulate_combat(
                WasmCoreBridge.INPUT_UNIT_OFFSET,
                WasmCoreBridge.INPUT_UNIT_OFFSET + 64,
                rounds,
            );

            const result = this.readF32Array(resultPtr, 3);
            return {
                totalDamage: Math.round(result[0]),
                totalMoraleDamage: Math.round(result[1]),
                roundsSimulated: Math.round(result[2]),
            };
        } catch (err) {
            console.error('[WasmCoreBridge] simulate_combat failed:', err);
            return { totalDamage: 0, totalMoraleDamage: 0, roundsSimulated: 0 };
        }
    }

    /**
     * Wasm 체크섬 계산 호출 (데이터 무결성 검증용)
     */
    callChecksum(data: Uint8Array): number {
        if (!this.exports || !this.memory) {
            return this.fallbackChecksum(data);
        }

        try {
            const ptr = this.exports.malloc(data.length);
            if (!ptr) return 0;

            this.writeU8Array(data, ptr);
            const checksum = this.exports.checksum(ptr, data.length);
            this.exports.free(ptr);
            return checksum >>> 0;
        } catch (err) {
            console.error('[WasmCoreBridge] checksum failed:', err);
            return this.fallbackChecksum(data);
        }
    }

    // ============================================================
    // JS 폴백 구현 (Wasm 미탑재 시)
    // ============================================================

    /**
     * JS A* 길찾기 폴백
     * (Wasm 미탑재 환경에서도 동작 보장)
     */
    private fallbackPathfinding(
        gridCells: Float32Array,
        gridW: number,
        gridH: number,
        startX: number,
        startY: number,
        endX: number,
        endY: number,
    ): PathResult {
        const cellsPerRow = 4; // height, terrainType, isBlocked, moveCost
        const startIdx = startY * gridW + startX;
        const endIdx = endY * gridW + endX;

        // 간단한 A* (JS 폴백)
        const cameFrom = new Map<number, number>();
        const gScore = new Map<number, number>();
        gScore.set(startIdx, 0);
        const fScore = new Map<number, number>();
        fScore.set(startIdx, this.heuristic(startIdx, endIdx, gridW));

        const openHeap: number[] = [startIdx];
        const inOpen = new Set<number>([startIdx]);

        while (openHeap.length > 0) {
            // 최소 fScore 노드 추출 (linear scan, 소규모 그리드에 적합)
            let bestIdx = 0;
            let bestF = fScore.get(openHeap[0]) ?? Infinity;
            for (let i = 1; i < openHeap.length; i++) {
                const f = fScore.get(openHeap[i]) ?? Infinity;
                if (f < bestF) { bestF = f; bestIdx = i; }
            }
            const current = openHeap[bestIdx];
            openHeap.splice(bestIdx, 1);
            inOpen.delete(current);

            if (current === endIdx) {
                // 경로 재구성
                const path: { x: number; y: number }[] = [];
                let node: number | undefined = current;
                while (node !== undefined && node !== startIdx) {
                    path.unshift({ x: node % gridW, y: Math.floor(node / gridW) });
                    node = cameFrom.get(node);
                }
                path.unshift({ x: startX, y: startY });
                return {
                    path,
                    length: path.length,
                    totalCost: gScore.get(endIdx) ?? 0,
                };
            }

            const currentG = gScore.get(current) ?? Infinity;
            const cx = current % gridW;
            const cy = Math.floor(current / gridW);

            for (const nIdx of this.getNeighbors(current, gridW, gridH, gridCells)) {
                const nx = nIdx % gridW;
                const ny = Math.floor(nIdx / gridW);
                const cellOffset = nIdx * cellsPerRow;
                const moveCost = gridCells[cellOffset + 3];
                const dist = Math.sqrt((cx - nx) ** 2 + (cy - ny) ** 2);
                const tentativeG = currentG + dist * moveCost;

                if (tentativeG < (gScore.get(nIdx) ?? Infinity)) {
                    cameFrom.set(nIdx, current);
                    gScore.set(nIdx, tentativeG);
                    fScore.set(nIdx, tentativeG + this.heuristic(nIdx, endIdx, gridW));
                    if (!inOpen.has(nIdx)) {
                        openHeap.push(nIdx);
                        inOpen.add(nIdx);
                    }
                }
            }
        }

        return { path: [], length: 0, totalCost: 0 };
    }

    private readonly cellsPerRow = 4;

    private heuristic(a: number, b: number, gridW: number): number {
        const ax = a % gridW;
        const ay = Math.floor(a / gridW);
        const bx = b % gridW;
        const by = Math.floor(b / gridW);
        return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
    }

    private getNeighbors(idx: number, gridW: number, gridH: number, gridCells: Float32Array): number[] {
        const x = idx % gridW;
        const y = Math.floor(idx / gridW);
        const result: number[] = [];
        // 헥사그리드 방향 (짝수/홀수 행)
        const dirs = x % 2 === 0
            ? [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]
            : [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
        for (const [dx, dy] of dirs) {
            const nx = dx + (x);
            const ny = dy + (y);
            if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                const nIdx = ny * gridW + nx;
                const blocked = gridCells[nIdx * this.cellsPerRow + 2];
                if (blocked === 0) result.push(nIdx);
            }
        }
        return result;
    }

    /**
     * JS 대미지 계산 폴백
     */
    private fallbackDamageCalc(
        attackerStats: Float32Array,
        defenderStats: Float32Array,
        terrainType: number,
        weather: number,
    ): DamageResult {
        // [attack, defense, hp, maxHp, morale, troopCount, troopType, leadership, experience]
        const atk = attackerStats[0];
        const def = defenderStats[1];
        const atkMorale = attackerStats[4];
        const defMorale = defenderStats[4];
        const atkTroops = attackerStats[5];
        const defTroops = defenderStats[5];

        // 지형 보정
        const terrainAtkBonus = terrainType === 1 ? 0.8 : terrainType === 2 ? 0.6 : 1.0; // 숲 -20%, 산 -40%
        const terrainDefBonus = terrainType === 1 ? 1.2 : terrainType === 2 ? 1.4 : 1.0;

        // 기상 보정
        const weatherAtkBonus = weather === 1 ? 0.9 : weather === 2 ? 0.8 : weather === 3 ? 0.7 : 1.0;

        // 명중률
        const accuracy = 0.85 + (attackerStats[7] / 200); // leadership 보정
        const isHit = accuracy > 0.5; // 단순화

        if (!isHit) {
            return { damage: 0, isCritical: false, isHit: false, moraleDamage: 0 };
        }

        // 크리티컬
        const critRate = 0.05 + (attackerStats[7] / 500); // leadership 기반
        const isCritical = critRate > 0.15;

        // 대미지 공식: (atk * terrainAtkBonus * weatherAtkBonus) - (def * terrainDefBonus * 0.6)
        const rawDamage = (attackerStats[0] * terrainAtkBonus * weatherAtkBonus)
            - (defenderStats[1] * terrainDefBonus * 0.6);
        const critMul = isCritical ? 1.5 : 1.0;
        const troopRatio = Math.min(1, atkTroops / Math.max(1, defTroops));
        const damage = Math.max(1, Math.round(rawDamage * critMul * troopRatio));

        // 사기 대미지: 대미지의 10~20%
        const moraleDamage = Math.max(0, Math.round(damage * 0.15));

        return { damage, isCritical, isHit: true, moraleDamage };
    }

    /**
     * JS 체크섬 폴백 (FNV-1a)
     */
    private fallbackChecksum(data: Uint8Array): number {
        let hash = 0x811C9DC5; // FNV offset basis
        for (let i = 0; i < data.length; i++) {
            hash ^= data[i];
            hash = Math.imul(hash, 0x01000193); // FNV prime
        }
        return hash >>> 0;
    }

    /** Wasm 인스턴스 해제 */
    dispose(): void {
        this.instance = null;
        this.memory = null;
        this.exports = null;
        this._ready = false;
    }
}
