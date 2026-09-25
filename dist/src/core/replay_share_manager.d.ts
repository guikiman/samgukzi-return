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
export declare function base64UrlEncode(bytes: Uint8Array): string;
export declare function base64UrlDecode(encoded: string): Uint8Array;
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
export declare class ReplayShareManager {
    /** 내부 저장은 항상 미니피케이션 형식 (URL 크기 최적화 단일 소스) */
    private currentBattleLogs;
    /** 커맨드 실행/undo/redo 로그 — 전투 리플레이와 세이브 델타 양쪽에서 재사용 */
    private currentCommandEvents;
    /** 새로운 전투 시작 시 기존 로그 초기화 */
    clearLogs(): void;
    get logCount(): number;
    /** [O(1)] 전투 중 발생한 행동(이동/공격/계략/피해)을 실시간 누적 */
    recordAction(turn: number, officerId: string, actionType: string, targetId: string | null, value: number, x: number, y: number): void;
    /** 직접 로그 배열 주입 (리플레이 파서/테스트용) */
    loadLogs(logs: readonly ReplayActionLog[]): void;
    getLogs(): ReplayActionLog[];
    /** 전투·포로·외교 커맨드 이벤트를 리플레이에 기록한다. */
    recordCommandEvent(event: ReplayCommandEvent): void;
    getCommandEvents(): ReplayCommandEvent[];
    /**
     * [312] 100-kB 가압축 파이프라인
     * 1. 전체 전투 로그 → JSON 문자열
     * 2. gzip 최대 압축
     * 3. URL-Safe Base64 인코딩 → ?replay= 파라미터
     */
    exportToCompressedString(): Promise<string>;
    /** 압축 문자열 → 전투 로그 복원 */
    importFromCompressedString(compressedStr: string): Promise<ReplayActionLog[]>;
    /** [302] 세이브 데이터 초고효율 압축 */
    compressSaveData(saveData: unknown): Promise<string>;
    /** [302] 세이브 데이터 복원 */
    decompressSaveData<T = unknown>(compressed: string): Promise<T | null>;
    /** 압축 결과가 100kB 이하인지 확인 후, 초과 시 경고 (URL 길이 보호) */
    exportForUrlSharing(): Promise<string>;
}
/** 편의 함수: 로그 배열 → 압축 URL 파라미터 문자열 */
export declare function encodeReplayLogs(logs: readonly ReplayActionLog[]): Promise<string>;
/** 편의 함수: 압축 문자열 → 로그 배열 */
export declare function decodeReplayLogs(compressed: string): Promise<ReplayActionLog[]>;
//# sourceMappingURL=replay_share_manager.d.ts.map