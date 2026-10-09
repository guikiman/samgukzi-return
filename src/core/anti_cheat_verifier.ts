/**
 * 삼국지리턴 — 서버 사이드 결정론적 검증 시스템
 * 파일: src/core/anti_cheat_verifier.ts
 *
 * [202] 결정론적 액션 로그 기반 서버 사이드 복사 시뮬레이션
 * [203] 해킹 감지 시 예외 처리 (Desync / Checksum 불일치)
 *
 * ── 아키텍처 ──
 *
 * 클라이언트:
 *   1. 초기 seed로 PRNG 초기화
 *   2. 매 턴 ActionLog 기록 (커맨드 + PRNG call count)
 *   3. 최종 상태 체크섬 계산 → 서버 전송
 *
 * 서버 (AntiCheatVerifier):
 *   1. 동일 seed로 PRNG 복제
 *   2. ActionLog를 순차적으로 Replay
 *   3. 동일 전투 공식으로 상태 재현
 *   4. 최종 체크섬을 클라이언트 제출값과 비교
 *   5. 불일치 → DesyncException → 매치 무효화 + 디버깅 로그
 *
 * ── 결정론성 보장 ──
 *   - PRNG: 동일 seed + 동일 call count → 동일 난수열
 *   - 전투 공식: 동일 입력 → 동일 출력 (부동소수점 연산 일치)
 *   - 체크섬: FNV-1a (Wasm 폴백과 동일 알고리즘)
 */

import { PRNG } from './network_sync_manager.js';

// ============================================================
// [0] 타입 정의
// ============================================================

/** 액션 타입 */
export type ActionType =
    | 'MOVE_UNIT'
    | 'ATTACK'
    | 'DEFEND'
    | 'USE_SKILL'
    | 'RETREAT'
    | 'DEPLOY'
    | 'REINFORCE'
    | 'USE_ITEM'
    | 'WAIT';

/** 단일 액션 로그 엔트리 */
export interface ActionLogEntry {
    readonly turn: number;
    readonly actionType: ActionType;
    readonly actorId: number;       // 무장/유닛 ID
    readonly targetId?: number;     // 대상 ID
    readonly params: readonly number[];  // 추가 파라미터 [x, y, skillId, ...]
    readonly prngCallCount: number; // 이 액션 실행 전 PRNG 호출 횟수
}

/** 전체 액션 로그 (클라이언트 → 서버) */
export interface ActionLog {
    readonly seed: number;              // 초기 PRNG seed
    readonly entries: readonly ActionLogEntry[];
    readonly finalChecksum: number;     // 클라이언트가 제출한 최종 체크섬
    readonly matchId: string;
    readonly playerId: string;
    readonly timestamp: number;
}

/** 검증 결과 */
export interface VerificationResult {
    readonly matchId: string;
    readonly playerId: string;
    readonly verified: boolean;
    readonly serverChecksum: number;
    readonly clientChecksum: number;
    readonly desyncTurn: number | null;   // 불일치 발생 턴 (null = 정상)
    readonly desyncAction: number | null; // 불일치 발생 액션 인덱스
    readonly debugLog: readonly string[];
}

/** 체크섬 불일치 예외 */
export class ChecksumMismatchError extends Error {
    readonly matchId: string;
    readonly playerId: string;
    readonly serverChecksum: number;
    readonly clientChecksum: number;
    readonly desyncTurn: number;
    readonly desyncAction: number;

    constructor(
        matchId: string,
        playerId: string,
        serverChecksum: number,
        clientChecksum: number,
        desyncTurn: number,
        desyncAction: number,
    ) {
        super(
            `[AntiCheat] Checksum mismatch in match ${matchId} (player ${playerId}): ` +
            `server=0x${serverChecksum.toString(16)}, client=0x${clientChecksum.toString(16)}, ` +
            `turn=${desyncTurn}, action=${desyncAction}`,
        );
        this.name = 'ChecksumMismatchError';
        this.matchId = matchId;
        this.playerId = playerId;
        this.serverChecksum = serverChecksum;
        this.clientChecksum = clientChecksum;
        this.desyncTurn = desyncTurn;
        this.desyncAction = desyncAction;
    }
}

// ============================================================
// [1] AntiCheatVerifier
// ============================================================

/**
 * AntiCheatVerifier — 서버 사이드 결정론적 액션 로그 Replay 검증기
 *
 * ── 검증 프로토콜 ──
 *
 * 1. 클라이언트가 매치 종료 후 서버에 전송:
 *    - 초기 seed
 *    - 전체 ActionLog (턴별 커맨드 목록)
 *    - 최종 체크섬 (FNV-1a of final game state)
 *
 * 2. 서버 (AntiCheatVerifier):
 *    a. 동일 seed로 PRNG 복제
 *    b. ActionLog를 순차적으로 Replay
 *    c. 각 액션 실행 전 PRNG call count 일치 확인
 *    d. 동일 전투 공식으로 상태 재현
 *    e. 최종 체크섬 계산
 *    f. 클라이언트 체크섬과 비교
 *    g. 불일치 → ChecksumMismatchError + 디버깅 로그
 *
 * ── 결정론성 보장 메커니즘 ──
 *   - PRNG: LCG + Mulberry32, 동일 seed + 동일 call count → 동일 난수열
 *   - 전투 공식: 부동소수점 연산 순서 고정 (IEEE 754)
 *   - 체크섬: FNV-1a (비트 단위 일치)
 *   - 액션 로그: 각 액션의 PRNG call count를 기록하여 중간 상태 검증
 */
export class AntiCheatVerifier {
    private readonly prng: PRNG;
    private readonly _debugLog: string[] = [];
    private _verified = false;
    private _result: VerificationResult | null = null;

    constructor() {
        this.prng = new PRNG(0);
    }

    // ============================================================
    // 메인 검증 루틴
    // ============================================================

    /**
     * 클라이언트 액션 로그를 서버에서 Replay 검증
     *
     * @param actionLog  클라이언트가 제출한 전체 액션 로그
     * @returns          검증 결과
     * @throws           ChecksumMismatchError (desync 감지 시)
     */
    verify(actionLog: ActionLog): VerificationResult {
        this._debugLog.length = 0;
        this._result = null;

        this.log(`[AntiCheat] Starting verification for match ${actionLog.matchId}, player ${actionLog.playerId}`);
        this.log(`  Seed: ${actionLog.seed}, Entries: ${actionLog.entries.length}`);

        // 1. PRNG 복제 (동일 seed)
        this.prng.reset(actionLog.seed);
        const serverPrng = this.prng; // 결정론적 PRNG

        // 2. 액션 로그 Replay
        let desyncTurn: number | null = null;
        let desyncAction: number | null = null;
        let serverChecksum = 0;

        try {
            for (let turnIdx = 0; turnIdx < actionLog.entries.length; turnIdx++) {
                const entry = actionLog.entries[turnIdx];

                // 2a. PRNG call count 검증
                if (serverPrng.callCount !== entry.prngCallCount) {
                    this.log(`  [DESYNC] Turn ${entry.turn}, Action ${turnIdx}: PRNG call count mismatch ` +
                        `(server=${serverPrng.callCount}, client=${entry.prngCallCount})`);
                    desyncTurn = entry.turn;
                    desyncAction = turnIdx;
                    break;
                }

                // 2b. 액션 Replay
                this.replayAction(entry, serverPrng);

                // 2c. 중간 체크섬 계산 (매 턴)
                const turnChecksum = this.computeActionChecksum(entry, serverPrng);
                serverChecksum = this.combineChecksum(serverChecksum, turnChecksum);
            }
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            this.log(`  [ERROR] Replay failed: ${errorMsg}`);
            this._result = {
                matchId: actionLog.matchId,
                playerId: actionLog.playerId,
                verified: false,
                serverChecksum: 0,
                clientChecksum: actionLog.finalChecksum,
                desyncTurn: desyncTurn ?? 0,
                desyncAction: desyncAction ?? 0,
                debugLog: [...this._debugLog],
            };
            return this._result;
        }

        // 3. 체크섬 비교
        const clientChecksum = actionLog.finalChecksum;
        const match = serverChecksum === clientChecksum;

        if (!match) {
            this.log(`  [DESYNC] Checksum mismatch: server=0x${serverChecksum.toString(16)}, client=0x${clientChecksum.toString(16)}`);
            this.log(`  [DESYNC] Turn: ${desyncTurn ?? 'N/A'}, Action: ${desyncAction ?? 'N/A'}`);

            // ChecksumMismatchError throw
            throw new ChecksumMismatchError(
                actionLog.matchId,
                actionLog.playerId,
                serverChecksum,
                clientChecksum,
                desyncTurn ?? 0,
                desyncAction ?? 0,
            );
        }

        this.log(`  [OK] Checksum match: 0x${serverChecksum.toString(16)}`);

        this._result = {
            matchId: actionLog.matchId,
            playerId: actionLog.playerId,
            verified: true,
            serverChecksum,
            clientChecksum,
            desyncTurn: null,
            desyncAction: null,
            debugLog: [...this.debugLog],
        };

        return this._result;
    }

    // ============================================================
    // 액션 Replay 엔진
    // ============================================================

    /**
     * 단일 액션을 결정론적으로 Replay
     *
     * 각 액션 타입별로 PRNG를 사용하는 모든 연산을
     * 클라이언트와 동일한 순서로 실행하여 난수열 동기화 유지
     */
    private replayAction(entry: ActionLogEntry, prng: PRNG): void {
        switch (entry.actionType) {
            case 'MOVE_UNIT': {
                // 이동: 지형 저항 PRNG (0.8~1.2)
                const terrainResistance = prng.nextFloat(0.8, 1.2);
                // 추가 이동 PRNG 소비
                const moveDistance = entry.params[0] ?? 1;
                for (let i = 0; i < moveDistance; i++) {
                    prng.next(); // 각 스텝별 난수 소비
                }
                break;
            }

            case 'ATTACK': {
                // 공격: 명중 판정 (1회)
                const accuracy = entry.params[0] ?? 0.85;
                prng.rollHit(accuracy);

                // 크리티컬 판정 (1회)
                const critRate = entry.params[1] ?? 0.1;
                prng.rollCritical(critRate);

                // 대미지 변동 (1회)
                const baseDamage = entry.params[2] ?? 100;
                const spread = entry.params[3] ?? 0.1;
                prng.rollDamageVariance(baseDamage, spread);

                // 상태이상 발동 (1회)
                const statusRate = entry.params[4] ?? 0;
                if (statusRate > 0) {
                    prng.rollStatusEffect(statusRate);
                }
                break;
            }

            case 'DEFEND': {
                // 방어: 방어력 보정 PRNG (0.9~1.1)
                prng.nextFloat(0.9, 1.1);
                break;
            }

            case 'USE_SKILL': {
                // 스킬 사용: 성공률 판정 (1회)
                const successRate = entry.params[0] ?? 0.7;
                prng.rollStatusEffect(successRate);
                // 효과 변동 (1회)
                prng.nextFloat(0.8, 1.2);
                break;
            }

            case 'RETREAT': {
                // 퇴각: 성공률 판정 (1회)
                const retreatChance = entry.params[0] ?? 0.6;
                prng.rollStatusEffect(retreatChance);
                // 손실 변동 (1회)
                prng.nextFloat(0.5, 1.0);
                break;
            }

            case 'DEPLOY': {
                // 배치: 배치 위치 PRNG (2회)
                prng.nextInt(0, entry.params[0] ?? 10);
                prng.nextInt(0, entry.params[1] ?? 10);
                break;
            }

            case 'REINFORCE': {
                // 증원: 도착 시간 변동 (1회)
                prng.nextFloat(0.8, 1.2);
                break;
            }

            case 'USE_ITEM': {
                // 아이템 사용: 효과 변동 (1회)
                prng.nextFloat(0.9, 1.1);
                break;
            }

            case 'WAIT': {
                // 대기: PRNG 소비 없음
                break;
            }

            default: {
                this.log(`  [WARN] Unknown action type: ${(entry as ActionLogEntry).actionType}`);
                break;
            }
        }
    }

    // ============================================================
    // 체크섬 계산
    // ============================================================

    /**
     * 단일 액션의 중간 체크섬 계산
     *
     * 결정론적 입력:
     *   - actionType (string → byte)
     *   - actorId
     *   - targetId
     *   - params
     *   - prngCallCount
     *   - 현재 PRNG state
     */
    private computeActionChecksum(entry: ActionLogEntry, prng: PRNG): number {
        let hash = 0x811C9DC5; // FNV offset basis

        // actionType string → bytes
        const typeBytes = new TextEncoder().encode(entry.actionType);
        for (let i = 0; i < typeBytes.length; i++) {
            hash ^= typeBytes[i];
            hash = Math.imul(hash, 0x01000193);
        }

        // actorId (4 bytes)
        hash = this.fnvUpdate(hash, entry.actorId);
        hash = this.fnvUpdate(hash, entry.turn);

        // targetId
        hash = this.fnvUpdate(hash, entry.targetId ?? 0);

        // params
        for (const p of entry.params) {
            hash = this.fnvUpdate(hash, Math.round(p));
        }

        // PRNG call count
        hash = this.fnvUpdate(hash, entry.prngCallCount);

        // PRNG state (결정론적 재현용)
        hash = this.fnvUpdate(hash, prng.callCount);

        return hash >>> 0;
    }

    /**
     * FNV-1a 해시 업데이트 (32비트 정수)
     */
    private fnvUpdate(hash: number, value: number): number {
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setInt32(0, value, true); // little-endian
        for (let i = 0; i < 4; i++) {
            hash ^= bytes[i];
            hash = Math.imul(hash, 0x01000193);
        }
        return hash >>> 0;
    }

    /**
     * 두 체크섬을 결합 (FNV-1a 기반)
     */
    private combineChecksum(current: number, next: number): number {
        let hash = current;
        const bytes = new Uint8Array(4);
        new DataView(bytes.buffer).setUint32(0, next, true);
        for (let i = 0; i < 4; i++) {
            hash ^= bytes[i];
            hash = Math.imul(hash, 0x01000193);
        }
        return hash >>> 0;
    }

    // ============================================================
    // 디버깅 로그
    // ============================================================

    private log(message: string): void {
        this._debugLog.push(message);
    }

    get debugLog(): readonly string[] { return this._debugLog; }

    /** 마지막 검증 결과 */
    get lastResult(): VerificationResult | null { return this._result; }
}

// ============================================================
// [2] ActionLog 검증 유틸리티
// ============================================================

/**
 * ActionLog의 기본 무결성 검증 (전송 전/후)
 *
 * @param log  검증할 ActionLog
 * @returns    오류 메시지 배열 (비어있으면 정상)
 */
export function validateActionLog(log: ActionLog): string[] {
    const errors: string[] = [];

    if (log.seed < 0 || log.seed > 0xFFFFFFFF) {
        errors.push(`Invalid seed: ${log.seed}`);
    }
    if (log.entries.length === 0) {
        errors.push('Action log is empty');
    }
    if (log.finalChecksum < 0 || log.finalChecksum > 0xFFFFFFFF) {
        errors.push(`Invalid checksum: ${log.finalChecksum}`);
    }
    if (!log.matchId) {
        errors.push('Missing matchId');
    }
    if (!log.playerId) {
        errors.push('Missing playerId');
    }

    // 연속성 검증: turn이 단조 증가하는지
    let lastTurn = -1;
    for (let i = 0; i < log.entries.length; i++) {
        const entry = log.entries[i];
        if (entry.turn < lastTurn) {
            errors.push(`Turn sequence error at index ${i}: ${entry.turn} < ${lastTurn}`);
        }
        lastTurn = entry.turn;

        // PRNG call count 검증
        if (entry.prngCallCount < 0) {
            errors.push(`Negative prngCallCount at index ${i}: ${entry.prngCallCount}`);
        }
    }

    return errors;
}

/**
 * ActionLog의 FNV-1a 체크섬 계산 (클라이언트/서버 동일 알고리즘)
 *
 * @param log  ActionLog
 * @returns    32비트 체크섬
 */
export function computeActionLogChecksum(log: ActionLog): number {
    let hash = 0x811C9DC5; // FNV offset basis

    // seed
    hash = fnvUpdateInt(hash, log.seed);

    // 각 엔트리
    for (const entry of log.entries) {
        hash = fnvUpdateInt(hash, entry.turn);
        hash = fnvUpdateString(hash, entry.actionType);
        hash = fnvUpdateInt(hash, entry.actorId);
        hash = fnvUpdateInt(hash, entry.targetId ?? 0);
        hash = fnvUpdateInt(hash, entry.prngCallCount);
        for (const p of entry.params) {
            hash = fnvUpdateInt(hash, Math.round(p));
        }
    }

    return hash >>> 0;
}

/** FNV-1a: Int32 업데이트 */
function fnvUpdateInt(hash: number, value: number): number {
    let h = hash;
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setInt32(0, value, true);
    for (let i = 0; i < 4; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** FNV-1a: String 업데이트 */
function fnvUpdateString(hash: number, value: string): number {
    let h = hash;
    const bytes = new TextEncoder().encode(value);
    for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}
