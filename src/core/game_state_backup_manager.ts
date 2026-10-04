import {
    NormalizedState, Officer, Faction, City, Army, RelationshipEdge,
    OfficerID, CommandType,
} from './types.js';
import { GameStore } from './game_store.js';

// ============================================================
// 타입 정의
// ============================================================

export interface StateDelta {
    readonly officers: Record<string, Partial<Officer> | null>;
    readonly factions: Record<string, Partial<Faction> | null>;
    readonly cities: Record<string, Partial<City> | null>;
    readonly armies: Record<string, Partial<Army> | null>;
    readonly relationships: Record<string, RelationshipEdge | null>;
    readonly turnCount: number;
    readonly timestamp: number;
}

export interface CompressedSaveBlob {
    readonly version: number;
    readonly turnCount: number;
    readonly gameTime: { year: number; month: number };
    readonly compressed: string;
    readonly checksum: string;
    readonly parentChecksum: string | null;
    readonly metadata: {
        readonly label: string;
        readonly timestamp: number;
        readonly compressedSizeBytes: number;
        readonly originalSizeBytes: number;
    };
}

export interface TimeMachineNode {
    readonly id: string;
    readonly turnCount: number;
    readonly gameTime: { year: number; month: number };
    readonly label: string;
    readonly timestamp: number;
    readonly delta: StateDelta;
    readonly fullSnapshot?: NormalizedState;
    readonly commandSummary: string;
    readonly checksum: string;
}

export interface RollbackResult {
    success: boolean;
    restoredTurnCount: number;
    restoredTime: { year: number; month: number };
    commandsRolledBack: number;
    message: string;
}

export interface BackupStats {
    totalSnapshots: number;
    totalDeltas: number;
    totalCompressedBytes: number;
    totalOriginalBytes: number;
    compressionRatio: number;
    oldestTurn: number;
    newestTurn: number;
    memoryUsageBytes: number;
}

// ============================================================
// [1] 델타 변경점 추적 엔진
// ============================================================

export class DeltaEngine {
    computeDelta(current: NormalizedState, previous: NormalizedState): StateDelta {
        return {
            officers: diffRecord(current.officers, previous.officers, deepEqual),
            factions: diffRecord(current.factions, previous.factions, deepEqual),
            cities: diffRecord(current.cities, previous.cities, deepEqual),
            armies: diffRecord(current.armies, previous.armies, deepEqual),
            relationships: diffRecord(current.relationships, previous.relationships, deepEqual),
            turnCount: 0,
            timestamp: Date.now(),
        };
    }

    applyDelta(base: NormalizedState, delta: StateDelta): NormalizedState {
        const result = deepCloneState(base);
        applyRecordDelta(result.officers, delta.officers);
        applyRecordDelta(result.factions, delta.factions);
        applyRecordDelta(result.cities, delta.cities);
        applyRecordDelta(result.armies, delta.armies);
        applyRecordDelta(result.relationships, delta.relationships);
        return result;
    }

    estimateDeltaSize(delta: StateDelta): number {
        let size = 0;
        size += countKeys(delta.officers) * 120;
        size += countKeys(delta.factions) * 80;
        size += countKeys(delta.cities) * 100;
        size += countKeys(delta.armies) * 60;
        size += countKeys(delta.relationships) * 50;
        return size;
    }

    static emptyState(): NormalizedState {
        return {
            officers: {},
            factions: {},
            cities: {},
            armies: {},
            mapFeatures: {},
            sieges: {},
            migrationTribes: {},
            invasionDemands: {},
            imperialCourt: null,
            relationships: {},
            byFaction: { officers: {}, cities: {}, armies: {}, mapFeatures: {} },
            byCity: { officers: {}, tribes: {} },
            byOfficer: { relationships: {} },
        };
    }
}

function diffRecord<T>(
    current: Record<string, T>,
    previous: Record<string, T>,
    comparator: (a: T, b: T) => boolean,
): Record<string, T | null> {
    const delta: Record<string, T | null> = {};
    const allKeys = new Set([...Object.keys(current), ...Object.keys(previous)]);

    for (const key of allKeys) {
        const hasCurrent = Object.prototype.hasOwnProperty.call(current, key);
        const hasPrev = Object.prototype.hasOwnProperty.call(previous, key);

        if (hasCurrent && !hasPrev) {
            delta[key] = current[key];
        } else if (!hasCurrent && hasPrev) {
            delta[key] = null;
        } else if (hasCurrent && hasPrev) {
            if (!comparator(current[key], previous[key])) {
                delta[key] = current[key];
            }
        }
    }

    return delta;
}

function deepEqual(a: unknown, b: unknown, depth = 0): boolean {
    if (depth > 10) return true;
    if (Object.is(a, b)) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return a === b;

    const aArr = Array.isArray(a);
    const bArr = Array.isArray(b);
    if (aArr !== bArr) return false;

    if (aArr) {
        const arrA = a as readonly unknown[];
        const arrB = b as readonly unknown[];
        if (arrA.length !== arrB.length) return false;
        for (let i = 0; i < arrA.length; i++) {
            if (!deepEqual(arrA[i], arrB[i], depth + 1)) return false;
        }
        return true;
    }

    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;
    const keysA = Object.keys(objA);
    const keysB = Object.keys(objB);
    if (keysA.length !== keysB.length) return false;

    for (const key of keysA) {
        if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
        if (!deepEqual(objA[key], objB[key], depth + 1)) return false;
    }

    return true;
}

function applyRecordDelta<T>(
    target: Record<string, T>,
    delta: Record<string, T | null>,
): void {
    for (const [key, value] of Object.entries(delta)) {
        if (value === null) {
            delete target[key];
        } else {
            target[key] = value;
        }
    }
}

function countKeys(record: Record<string, unknown>): number {
    return Object.keys(record).length;
}

function deepCloneState(state: NormalizedState): NormalizedState {
    return JSON.parse(JSON.stringify(state));
}

// ============================================================
// [2] LZ-String 스타일 + Base64 압축 코덱
// ============================================================

export class CompressionCodec {
    private static readonly MIN_MATCH = 3;
    private static readonly MAX_MATCH = 128;
    private static readonly WINDOW_SIZE = 32768;

    private static readonly BASE64_CHARS =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    private static readonly BASE64_MAP: Record<string, number> = {};
    static {
        for (let i = 0; i < 64; i++) {
            CompressionCodec.BASE64_MAP[CompressionCodec.BASE64_CHARS[i]] = i;
        }
    }

    compress(data: string): string {
        const input = this.stringToCodeUnits(data);
        const tokens = this.lz77Compress(input);
        const bytes = this.tokensToBytes(tokens);
        return CompressionCodec.base64Encode(bytes);
    }

    decompress(compressed: string): string {
        const bytes = CompressionCodec.base64Decode(compressed);
        const tokens = this.bytesToTokens(bytes);
        const codeUnits = this.lz77Decompress(tokens);
        return this.codeUnitsToString(codeUnits);
    }

    estimateRatio(original: string): number {
        const c = this.compress(original);
        return c.length > 0 ? 1 - c.length / original.length : 0;
    }

    private lz77Compress(input: readonly number[]): number[] {
        const output: number[] = [];
        let pos = 0;
        while (pos < input.length) {
            let bestDist = 0;
            let bestLen = 0;
            const ws = Math.max(0, pos - CompressionCodec.WINDOW_SIZE);
            const sl = Math.min(pos + CompressionCodec.MAX_MATCH, input.length);
            for (let sp = pos - 1; sp >= ws; sp--) {
                let ml = 0;
                while (ml < CompressionCodec.MAX_MATCH && pos + ml < input.length && input[sp + ml] === input[pos + ml]) {
                    ml++;
                }
                if (ml >= CompressionCodec.MIN_MATCH && ml > bestLen) {
                    bestLen = ml;
                    bestDist = pos - sp;
                }
            }
            if (bestLen >= CompressionCodec.MIN_MATCH) {
                output.push(bestDist | 0x8000);
                output.push(bestLen);
                pos += bestLen;
            } else {
                output.push(input[pos]);
                pos++;
            }
        }
        return output;
    }

    private lz77Decompress(tokens: readonly number[]): number[] {
        const output: number[] = [];
        const maxOut = tokens.length * 10;
        let i = 0;
        while (i < tokens.length && output.length < maxOut) {
            const t = tokens[i];
            if (t & 0x8000) {
                const dist = t & 0x7FFF;
                i++;
                if (i >= tokens.length) break;
                const len = tokens[i];
                const start = output.length - dist;
                if (start >= 0) {
                    for (let j = 0; j < len && output.length < maxOut; j++) {
                        output.push(output[start + j]);
                    }
                } else {
                    for (let j = 0; j < len && output.length < maxOut; j++) {
                        output.push(0);
                    }
                }
            } else {
                output.push(t);
            }
            i++;
        }
        return output;
    }

    private tokensToBytes(tokens: readonly number[]): Uint8Array {
        const bytes = new Uint8Array(tokens.length * 2);
        for (let i = 0; i < tokens.length; i++) {
            bytes[i * 2] = (tokens[i] >> 8) & 0xFF;
            bytes[i * 2 + 1] = tokens[i] & 0xFF;
        }
        return bytes;
    }

    private bytesToTokens(bytes: Uint8Array): number[] {
        const tokens: number[] = [];
        for (let i = 0; i < bytes.length; i += 2) {
            if (i + 1 >= bytes.length) break;
            tokens.push((bytes[i] << 8) | bytes[i + 1]);
        }
        return tokens;
    }

    static base64Encode(bytes: Uint8Array): string {
        let r = '';
        for (let i = 0; i < bytes.length; i += 3) {
            const b0 = bytes[i];
            const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
            const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
            const t = (b0 << 16) | (b1 << 8) | b2;
            r += CompressionCodec.BASE64_CHARS[(t >> 18) & 0x3F];
            r += CompressionCodec.BASE64_CHARS[(t >> 12) & 0x3F];
            if (i + 1 < bytes.length) r += CompressionCodec.BASE64_CHARS[(t >> 6) & 0x3F];
            if (i + 2 < bytes.length) r += CompressionCodec.BASE64_CHARS[t & 0x3F];
        }
        return r;
    }

    static base64Decode(str: string): Uint8Array {
        const pad = str.length % 4 === 0 ? str : str + '='.repeat(4 - (str.length % 4));
        const bytes: number[] = [];
        for (let i = 0; i < pad.length; i += 4) {
            const c0 = CompressionCodec.BASE64_MAP[pad[i]] ?? 0;
            const c1 = CompressionCodec.BASE64_MAP[pad[i + 1]] ?? 0;
            const c2 = pad[i + 2] === '=' ? 0 : (CompressionCodec.BASE64_MAP[pad[i + 2]] ?? 0);
            const c3 = pad[i + 3] === '=' ? 0 : (CompressionCodec.BASE64_MAP[pad[i + 3]] ?? 0);
            const t = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
            bytes.push((t >> 16) & 0xFF);
            if (pad[i + 2] !== '=') bytes.push((t >> 8) & 0xFF);
            if (pad[i + 3] !== '=') bytes.push(t & 0xFF);
        }
        return new Uint8Array(bytes);
    }

    private stringToCodeUnits(s: string): number[] {
        const u = new Array<number>(s.length);
        for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
        return u;
    }

    private codeUnitsToString(u: readonly number[]): string {
        const c = new Array<string>(u.length);
        for (let i = 0; i < u.length; i++) c[i] = String.fromCharCode(u[i]);
        return c.join('');
    }
}

// ============================================================
// [3] 타임머신 — Undo/Redo 롤백 스택
// ============================================================

export class TimeMachine {
    private nodes: TimeMachineNode[] = [];
    private currentIndex = -1;
    private readonly maxNodes: number;
    private readonly fullSnapshotInterval: number;
    private baseSnapshot: NormalizedState | null = null;
    private baseTurnCount = 0;
    private readonly deltaEngine: DeltaEngine;
    private readonly codec: CompressionCodec;

    constructor(maxNodes = 200, fullSnapshotInterval = 10) {
        this.maxNodes = maxNodes;
        this.fullSnapshotInterval = fullSnapshotInterval;
        this.deltaEngine = new DeltaEngine();
        this.codec = new CompressionCodec();
    }

    recordSnapshot(
        store: GameStore,
        label: string,
        commands: readonly { type: CommandType; officerId: OfficerID; description: string }[],
    ): void {
        const cs = store.createSnapshot();
        const gs = store.getGlobalState();
        const tc = gs.turnCount;

        let delta: StateDelta;
        let full = false;

        if (this.baseSnapshot === null) {
            delta = this.deltaEngine.computeDelta(cs, DeltaEngine.emptyState());
            full = true;
        } else {
            delta = this.deltaEngine.computeDelta(cs, this.baseSnapshot);
            if (tc - this.baseTurnCount >= this.fullSnapshotInterval ||
                this.deltaEngine.estimateDeltaSize(delta) > 50000) {
                full = true;
            }
        }

        const cmdSum = commands.length > 0
            ? commands.map(c => `${c.type}:${c.officerId}`).join(';')
            : '턴 진행';
        const chk = this.computeChecksum(JSON.stringify(delta));

        this.nodes.push({
            id: `turn_${tc}_${Date.now()}`,
            turnCount: tc,
            gameTime: { ...gs.time },
            label,
            timestamp: Date.now(),
            delta,
            fullSnapshot: full ? cs : undefined,
            commandSummary: cmdSum,
            checksum: chk,
        });
        this.currentIndex = this.nodes.length - 1;

        if (full) {
            this.baseSnapshot = cs;
            this.baseTurnCount = tc;
        }
        this.enforceMaxNodes();
        this.trimRedoHistory();
    }

    undo(store: GameStore): RollbackResult {
        if (!this.canUndo()) {
            return { success: false, restoredTurnCount: 0, restoredTime: { year: 0, month: 0 }, commandsRolledBack: 0, message: '되돌릴 기록이 없습니다' };
        }
        this.currentIndex--;
        return this.restoreAtCurrentIndex(store);
    }

    redo(store: GameStore): RollbackResult {
        if (!this.canRedo()) {
            return { success: false, restoredTurnCount: 0, restoredTime: { year: 0, month: 0 }, commandsRolledBack: 0, message: '앞으로 되돌릴 기록이 없습니다' };
        }
        this.currentIndex++;
        return this.restoreAtCurrentIndex(store);
    }

    rollbackToSnapshot(store: GameStore, targetTurn: number): RollbackResult {
        if (this.nodes.length === 0) {
            return { success: false, restoredTurnCount: 0, restoredTime: { year: 0, month: 0 }, commandsRolledBack: 0, message: '저장된 스냅샷이 없습니다' };
        }

        const ti = this.nodes.findIndex(n => n.turnCount === targetTurn);
        if (ti < 0) {
            return { success: false, restoredTurnCount: 0, restoredTime: { year: 0, month: 0 }, commandsRolledBack: 0, message: `턴 ${targetTurn}에 해당하는 스냅샷이 없습니다` };
        }

        let bi = ti;
        while (bi >= 0 && !this.nodes[bi].fullSnapshot) bi--;

        if (bi < 0) return this.rebuildFromStart(store, ti);

        const bn = this.nodes[bi];
        if (!bn.fullSnapshot) {
            return { success: false, restoredTurnCount: 0, restoredTime: { year: 0, month: 0 }, commandsRolledBack: 0, message: '체크포인트 스냅샷 손상' };
        }

        let state = bn.fullSnapshot;
        for (let i = bi + 1; i <= ti; i++) {
            state = this.deltaEngine.applyDelta(state, this.nodes[i].delta);
        }

        store.restoreSnapshot(state);
        this.currentIndex = ti;
        const n = this.nodes[ti];
        return {
            success: true,
            restoredTurnCount: n.turnCount,
            restoredTime: { ...n.gameTime },
            commandsRolledBack: ti - bi,
            message: `턴 ${n.turnCount}(${n.gameTime.year}년 ${n.gameTime.month}월)로 롤백 완료`,
        };
    }

    exportCompressedSave(store: GameStore, label: string): CompressedSaveBlob {
        const state = store.createSnapshot();
        const gs = store.getGlobalState();
        const json = JSON.stringify(state);
        const comp = this.codec.compress(json);
        return {
            version: 1,
            turnCount: gs.turnCount,
            gameTime: { ...gs.time },
            compressed: comp,
            checksum: this.computeChecksum(comp),
            parentChecksum: this.nodes.length > 0 ? this.nodes[this.nodes.length - 1].checksum : null,
            metadata: { label, timestamp: Date.now(), compressedSizeBytes: comp.length, originalSizeBytes: json.length },
        };
    }

    importCompressedSave(store: GameStore, blob: CompressedSaveBlob): boolean {
        if (this.computeChecksum(blob.compressed) !== blob.checksum) {
            return false;
        }
        try {
            store.restoreSnapshot(JSON.parse(this.codec.decompress(blob.compressed)) as NormalizedState);
            return true;
        } catch { return false; }
    }

    persistToLocalStorage(slot = 0): boolean {
        try {
            const json = JSON.stringify({ nodes: this.nodes, currentIndex: this.currentIndex, baseTurnCount: this.baseTurnCount });
            localStorage.setItem(`sangkukzi_backup_${slot}`, this.codec.compress(json));
            return true;
        } catch (err) {
            if (err instanceof DOMException && err.name === 'QuotaExceededError') {
                this.compact(0.5);
                return this.persistToLocalStorage(slot);
            }
            return false;
        }
    }

    loadFromLocalStorage(slot = 0): boolean {
        try {
            const raw = localStorage.getItem(`sangkukzi_backup_${slot}`);
            if (!raw) return false;
            const d = JSON.parse(this.codec.decompress(raw)) as { nodes: TimeMachineNode[]; currentIndex: number; baseTurnCount: number };
            this.nodes = d.nodes;
            this.currentIndex = d.currentIndex;
            this.baseTurnCount = d.baseTurnCount;
            this.baseSnapshot = null;
            return true;
        } catch { return false; }
    }

    clearAllSlots(): void {
        for (let i = 0; i < 10; i++) localStorage.removeItem(`sangkukzi_backup_${i}`);
    }

    compact(keepRatio = 0.5): void {
        if (this.nodes.length <= 1) return;
        const startIdx = this.nodes.length - Math.max(1, Math.floor(this.nodes.length * keepRatio));
        this.nodes = this.nodes.slice(startIdx);
        this.currentIndex = Math.max(-1, this.currentIndex - startIdx);
        this.baseSnapshot = null;
    }

    canUndo(): boolean { return this.currentIndex > 0; }
    canRedo(): boolean { return this.currentIndex < this.nodes.length - 1; }
    getCurrentTurn(): number { return this.currentIndex >= 0 ? this.nodes[this.currentIndex].turnCount : -1; }
    getHistoryLength(): number { return this.nodes.length; }

    getHistorySummary(): { turn: number; label: string; timestamp: number; isCheckpoint: boolean }[] {
        return this.nodes.map(n => ({ turn: n.turnCount, label: n.label, timestamp: n.timestamp, isCheckpoint: n.fullSnapshot !== undefined }));
    }

    getStats(): BackupStats {
        let tc = 0, to = 0;
        for (const n of this.nodes) {
            const j = JSON.stringify(n.delta);
            to += j.length;
            tc += this.codec.compress(j).length;
        }
        return {
            totalSnapshots: this.nodes.length,
            totalDeltas: this.nodes.filter(n => !n.fullSnapshot).length,
            totalCompressedBytes: tc,
            totalOriginalBytes: to,
            compressionRatio: to > 0 ? tc / to : 1,
            oldestTurn: this.nodes.length > 0 ? this.nodes[0].turnCount : 0,
            newestTurn: this.nodes.length > 0 ? this.nodes[this.nodes.length - 1].turnCount : 0,
            memoryUsageBytes: this.nodes.reduce((s, n) => s + JSON.stringify(n.delta).length + (n.fullSnapshot ? JSON.stringify(n.fullSnapshot).length : 0), 0),
        };
    }

    dispose(): void { this.nodes = []; this.currentIndex = -1; this.baseSnapshot = null; }

    private restoreAtCurrentIndex(store: GameStore): RollbackResult {
        if (this.currentIndex < 0 || this.currentIndex >= this.nodes.length) {
            this.currentIndex = Math.max(-1, Math.min(this.currentIndex, this.nodes.length - 1));
            return { success: false, restoredTurnCount: 0, restoredTime: { year: 0, month: 0 }, commandsRolledBack: 0, message: '복원할 상태가 없습니다' };
        }
        return this.rollbackToSnapshot(store, this.nodes[this.currentIndex].turnCount);
    }

    private rebuildFromStart(store: GameStore, ti: number): RollbackResult {
        if (this.nodes.length === 0 || !this.nodes[0].fullSnapshot) {
            return { success: false, restoredTurnCount: 0, restoredTime: { year: 0, month: 0 }, commandsRolledBack: 0, message: '초기 체크포인트가 없어 복원할 수 없습니다' };
        }
        let state = this.nodes[0].fullSnapshot;
        for (let i = 1; i <= ti; i++) state = this.deltaEngine.applyDelta(state, this.nodes[i].delta);
        store.restoreSnapshot(state);
        this.currentIndex = ti;
        const n = this.nodes[ti];
        return { success: true, restoredTurnCount: n.turnCount, restoredTime: { ...n.gameTime }, commandsRolledBack: ti, message: `턴 ${n.turnCount}(${n.gameTime.year}년 ${n.gameTime.month}월)로 롤백 완료 (처음부터 재구축)` };
    }

    private enforceMaxNodes(): void {
        while (this.nodes.length > this.maxNodes) { this.nodes.shift(); this.currentIndex--; }
    }

    private trimRedoHistory(): void {
        if (this.currentIndex < this.nodes.length - 1) this.nodes = this.nodes.slice(0, this.currentIndex + 1);
    }

    private computeChecksum(data: string): string {
        let h = 0x811C9DC5 >>> 0;
        for (let i = 0; i < data.length; i++) { h ^= data.charCodeAt(i) & 0xFF; h = Math.imul(h, 0x01000193) >>> 0; }
        return h.toString(16).padStart(8, '0');
    }
}

// ============================================================
// [4] GameStateBackupManager — 통합 퍼사드
// ============================================================

export class GameStateBackupManager {
    readonly deltaEngine: DeltaEngine;
    readonly codec: CompressionCodec;
    readonly timeMachine: TimeMachine;
    private store: GameStore | null = null;
    private autoSaveInterval: number;
    private lastAutoSaveTurn = -1;
    private autoSaveSlot = 0;

    constructor(autoSaveInterval = 5) {
        this.deltaEngine = new DeltaEngine();
        this.codec = new CompressionCodec();
        this.timeMachine = new TimeMachine();
        this.autoSaveInterval = autoSaveInterval;
    }

    initialize(store: GameStore): void { this.store = store; }

    recordSnapshot(
        label: string,
        commands: readonly { type: CommandType; officerId: OfficerID; description: string }[] = [],
    ): void {
        if (!this.store) return;
        this.timeMachine.recordSnapshot(this.store, label, commands);
        const turn = this.store.getGlobalState().turnCount;
        if (turn > 0 && turn % this.autoSaveInterval === 0 && turn !== this.lastAutoSaveTurn) {
            this.lastAutoSaveTurn = turn;
            this.persistToLocalStorage(this.autoSaveSlot);
        }
    }

    undo(): RollbackResult {
        if (!this.store) return { success: false, restoredTurnCount: 0, restoredTime: { year: 0, month: 0 }, commandsRolledBack: 0, message: 'GameStore가 초기화되지 않았습니다' };
        if (!this.timeMachine.canUndo()) return { success: false, restoredTurnCount: 0, restoredTime: { year: 0, month: 0 }, commandsRolledBack: 0, message: '되돌릴 기록이 없습니다' };
        return this.timeMachine.undo(this.store);
    }

    redo(): RollbackResult {
        if (!this.store) return { success: false, restoredTurnCount: 0, restoredTime: { year: 0, month: 0 }, commandsRolledBack: 0, message: 'GameStore가 초기화되지 않았습니다' };
        if (!this.timeMachine.canRedo()) return { success: false, restoredTurnCount: 0, restoredTime: { year: 0, month: 0 }, commandsRolledBack: 0, message: '앞으로 되돌릴 기록이 없습니다' };
        return this.timeMachine.redo(this.store);
    }

    rollbackToSnapshot(targetTurn: number): RollbackResult {
        if (!this.store) return { success: false, restoredTurnCount: 0, restoredTime: { year: 0, month: 0 }, commandsRolledBack: 0, message: 'GameStore가 초기화되지 않았습니다' };
        return this.timeMachine.rollbackToSnapshot(this.store, targetTurn);
    }

    exportCompressedSave(label: string): CompressedSaveBlob | null {
        if (!this.store) return null;
        return this.timeMachine.exportCompressedSave(this.store, label);
    }

    importCompressedSave(blob: CompressedSaveBlob): boolean {
        if (!this.store) return false;
        return this.timeMachine.importCompressedSave(this.store, blob);
    }

    persistToLocalStorage(slot = 0): boolean { return this.timeMachine.persistToLocalStorage(slot); }
    loadFromLocalStorage(slot = 0): boolean { return this.timeMachine.loadFromLocalStorage(slot); }
    compact(keepRatio = 0.5): void { this.timeMachine.compact(keepRatio); }
    getStats(): BackupStats { return this.timeMachine.getStats(); }
    canUndo(): boolean { return this.timeMachine.canUndo(); }
    canRedo(): boolean { return this.timeMachine.canRedo(); }
    getHistorySummary(): ReturnType<TimeMachine['getHistorySummary']> { return this.timeMachine.getHistorySummary(); }

    dispose(): void { this.store = null; this.timeMachine.dispose(); }
}
