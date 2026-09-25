/**
 * [312] 전투 리플레이 URL 공유 / [302] 세이브 데이터 초고효율 압축
 *
 * Python 원본: src/systems/replay_manager.py → TypeScript 포팅
 * - record_action → recordAction: 전투 행동 로그 실시간 누적 (key minification)
 * - export_to_compressed_string → exportToCompressedString: JSON → gzip → base64url
 * - import_from_compressed_string → importFromCompressedString: 역순 복원
 * - compress_save_data → compressSaveData
 *
 * zlib 대신 브라우저 내장 CompressionStream('gzip')을 사용한다.
 * Node 환경(테스트)에서도 Node 18+가 web streams를 지원하므로 동일 API로 동작한다.
 * 결과는 URL 파라미터(?replay=...)에 안전한 base64url 문자열이다.
 */

// ============================================================
// 1. 로그 엔트리 — 저장 크기 절감을 위해 1글자 키로 미니피케이션
// ============================================================

export interface ReplayActionLog {
    /** 턴 수 */
    turn: number;
    /** 행동 무장 ID */
    officerId: string;
    /** 행동 종류 (MOVE, ATTACK, STRATAGEM ...) */
    actionType: string;
    /** 대상 무장 ID (없으면 null) */
    targetId: string | null;
    /** 피해량 또는 회복량 */
    value: number;
    /** 웹 그리드 X 좌표 */
    x: number;
    /** 웹 그리드 Y 좌표 */
    y: number;
}

/** 미니피케이션된 직렬화 형식 (URL 크기 최적화) */
export interface MinifiedLogEntry {
    t: number;
    o: string;
    a: string;
    g: string | null;
    v: number;
    x: number;
    y: number;
}

function minify(log: ReplayActionLog): MinifiedLogEntry {
    return { t: log.turn, o: log.officerId, a: log.actionType, g: log.targetId, v: log.value, x: log.x, y: log.y };
}

function deminify(entry: MinifiedLogEntry): ReplayActionLog {
    return {
        turn: entry.t,
        officerId: entry.o,
        actionType: entry.a,
        targetId: entry.g,
        value: entry.v,
        x: entry.x,
        y: entry.y,
    };
}

// ============================================================
// 2. gzip + base64url 코덱
// ============================================================

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlDecode(encoded: string): Uint8Array {
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    const binary = atob(normalized + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function gzipCompress(text: string): Promise<Uint8Array> {
    const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gzipDecompress(bytes: Uint8Array): Promise<string> {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

// ============================================================
// 3. ReplayShareManager
// ============================================================

/** 전투·포로·외교 커맨드 실행/복구 이벤트 [312][131-145][341-360] */
export interface ReplayCommandEvent {
    readonly id: string;
    readonly commandType: string;
    readonly action: 'EXECUTE' | 'UNDO' | 'REDO';
    readonly turn: number;
    readonly timestamp: number;
    readonly success: boolean;
    readonly message: string;
    readonly logMessages: string[];
    readonly captiveOutcomes: Array<{
        officerId: string;
        officerName: string;
        decision: 'RECRUIT' | 'EXECUTE' | 'RELEASE';
        success: boolean;
        message: string;
    }>;
}

export class ReplayShareManager {
    /** 내부 저장은 항상 미니피케이션 형식 (URL 크기 최적화 단일 소스) */
    private currentBattleLogs: MinifiedLogEntry[] = [];
    /** 커맨드 실행/undo/redo 로그 — 전투 리플레이와 세이브 델타 양쪽에서 재사용 */
    private currentCommandEvents: ReplayCommandEvent[] = [];

    /** 새로운 전투 시작 시 기존 로그 초기화 */
    clearLogs(): void {
        this.currentBattleLogs = [];
        this.currentCommandEvents = [];
    }

    get logCount(): number {
        return this.currentBattleLogs.length;
    }

    /** [O(1)] 전투 중 발생한 행동(이동/공격/계략/피해)을 실시간 누적 */
    recordAction(turn: number, officerId: string, actionType: string, targetId: string | null, value: number, x: number, y: number): void {
        this.currentBattleLogs.push(minify({ turn, officerId, actionType, targetId, value, x, y }));
    }

    /** 직접 로그 배열 주입 (리플레이 파서/테스트용) */
    loadLogs(logs: readonly ReplayActionLog[]): void {
        this.currentBattleLogs = logs.map(minify);
    }

    getLogs(): ReplayActionLog[] {
        return this.currentBattleLogs.map(deminify);
    }

    /** 전투·포로·외교 커맨드 이벤트를 리플레이에 기록한다. */
    recordCommandEvent(event: ReplayCommandEvent): void {
        this.currentCommandEvents.push({
            ...event,
            logMessages: [...event.logMessages],
            captiveOutcomes: event.captiveOutcomes.map(outcome => ({ ...outcome })),
        });
    }

    getCommandEvents(): ReplayCommandEvent[] {
        return this.currentCommandEvents.map(event => ({
            ...event,
            logMessages: [...event.logMessages],
            captiveOutcomes: event.captiveOutcomes.map(outcome => ({ ...outcome })),
        }));
    }

    /**
     * [312] 100-kB 가압축 파이프라인
     * 1. 전체 전투 로그 → JSON 문자열
     * 2. gzip 최대 압축
     * 3. URL-Safe Base64 인코딩 → ?replay= 파라미터
     */
    async exportToCompressedString(): Promise<string> {
        try {
            if (this.currentBattleLogs.length === 0) return '';

            // 커맨드 이벤트가 있으면 버전된 envelope를 사용해 구버전 전투 로그와도 호환한다.
            const payload = this.currentCommandEvents.length > 0
                ? { v: 2, battle: this.currentBattleLogs, commands: this.currentCommandEvents }
                : this.currentBattleLogs;
            const jsonStr = JSON.stringify(payload);
            const compressed = await gzipCompress(jsonStr);
            return base64UrlEncode(compressed);
        } catch (err) {
            console.error('[ReplayEngine] 압축 중 오류 발생:', err);
            return '';
        }
    }

    /** 압축 문자열 → 전투 로그 복원 */
    async importFromCompressedString(compressedStr: string): Promise<ReplayActionLog[]> {
        try {
            if (!compressedStr) return [];
            const bytes = base64UrlDecode(compressedStr);
            const jsonStr = await gzipDecompress(bytes);
            const raw = JSON.parse(jsonStr) as MinifiedLogEntry[] | { v: 2; battle: MinifiedLogEntry[]; commands: ReplayCommandEvent[] };
            if (Array.isArray(raw)) return raw.map(deminify);
            if (!raw || raw.v !== 2 || !Array.isArray(raw.battle)) return [];
            this.currentBattleLogs = raw.battle;
            this.currentCommandEvents = Array.isArray(raw.commands) ? raw.commands : [];
            return this.currentBattleLogs.map(deminify);
        } catch {
            return [];
        }
    }

    /** [302] 세이브 데이터 초고효율 압축 */
    async compressSaveData(saveData: unknown): Promise<string> {
        const jsonStr = JSON.stringify(saveData);
        const compressed = await gzipCompress(jsonStr);
        return base64UrlEncode(compressed);
    }

    /** [302] 세이브 데이터 복원 */
    async decompressSaveData<T = unknown>(compressed: string): Promise<T | null> {
        try {
            const jsonStr = await gzipDecompress(base64UrlDecode(compressed));
            return JSON.parse(jsonStr) as T;
        } catch {
            return null;
        }
    }

    /** 압축 결과가 100kB 이하인지 확인 후, 초과 시 경고 (URL 길이 보호) */
    async exportForUrlSharing(): Promise<string> {
        const compressed = await this.exportToCompressedString();
        if (compressed.length > 100 * 1024) {
            console.warn(`[ReplayEngine] 압축 크기 ${compressed.length} bytes — 100kB 초과. 로그 축소 필요.`);
        }
        return compressed;
    }
}

/** 편의 함수: 로그 배열 → 압축 URL 파라미터 문자열 */
export async function encodeReplayLogs(logs: readonly ReplayActionLog[]): Promise<string> {
    const manager = new ReplayShareManager();
    manager.loadLogs(logs);
    return manager.exportToCompressedString();
}

/** 편의 함수: 압축 문자열 → 로그 배열 */
export async function decodeReplayLogs(compressed: string): Promise<ReplayActionLog[]> {
    const manager = new ReplayShareManager();
    return manager.importFromCompressedString(compressed);
}
