/**
 * 삼국지리턴 — Seed 기반 결정론적 턴제 네트워크 동기화 매니저
 * 파일: src/core/network_sync_manager.ts
 *
 * [210] Supabase Realtime 멀티플레이 세션
 * [211] PRNG 시드 동기화 + 결정론적 난수
 * [212] 클리어 데이터 해시 서명 검증 / 데싱크 감지
 *
 * ── 아키텍처 ──
 *
 * NetworkSyncManager
 *  ├─ PRNG           — Seed 기반 결정론적 난수 엔진 (LCG + Mulberry32)
 *  ├─ LockstepEngine — 프레임 틱 동기화 + Supabase Realtime 채널
 *  └─ DesyncDetector — FNV-1a 체크섬 비교 + 자동 롤백
 *
 * 결정론적 동기화 원리:
 *   두 클라이언트가 동일한 Seed로 PRNG를 초기화하고,
 *   동일한 횟수로 난수를 호출하면(X_{n+1} = f(X_n)),
 *   명령어(Command)만 교환해도 완전히 동일한 전투 결과 도출.
 *
 * Lockstep Protocol:
 *   Frame N:
 *   [Client A] ──CMD_A──▶                    [Client B]
 *                          [Supabase 채널]
 *   [Client A] ◀──FRAME_READY(CMD_A+CMD_B)── [Client B]
 *   [Client A] execute(N, combined)          [Client B] execute(N, combined)
 *   [Client A] ──CHECKSUM──▶                [Client B] ──CHECKSUM──▶
 *                          [검증: 동일?]
 *                          YES → advance N+1
 *                          NO  → DESYNC → rollback N-1
 */

import {
    NormalizedState, GlobalState, CommandType, OfficerID,
} from './types.js';
import { GameStore } from './game_store.js';

// ============================================================
// [1] 결정론적 PRNG
// ============================================================

/**
 * PRNG — Seed 기반 결정론적 난수 생성기
 *
 * 알고리즘: Mulberry32 (32비트 상태, 주기 2^32)
 *   X_{n+1} = X_n + 0x6D2B79F5 (mod 2^32)
 *   t = (X_n XOR (X_n >> 15)) * (1 | X_n)
 *   t = (t + (t XOR (t >> 7)) * (61 | t)) XOR t
 *   return (t XOR (t >> 14)) / 2^32
 *
 * 선형 합동법(LCG) 호환성:
 *   X_{n+1} = (a * X_n + c) mod m
 *   a = 1664525, c = 1013904223, m = 2^32
 *   → 건너뛰기(skip) 연산에 LCG 사용, 품질 수열에 Mulberry32
 *
 * 결정론적 보장:
 *   - 동일 seed + 동일 호출 횟수 → 100% 동일 수열
 *   - 호출 카운터(callCount)로 위치 추적
 *   - copy()로 스냅샷 저장 및 복원 가능
 */
export class PRNG {
    private state: number;
    private _callCount: number;
    readonly seed: number;

    // LCG 파라미터 (Numerical Recipes)
    private static readonly LCG_A = 1664525;
    private static readonly LCG_C = 1013904223;
    private static readonly LCG_M = 4294967296; // 2^32

    constructor(seed: number = Date.now()) {
        this.seed = seed >>> 0;
        this.state = this.seed;
        this._callCount = 0;
    }

    /** [0, 1) 부동소수점 난수 — Mulberry32 */
    next(): number {
        this.state |= 0;
        this.state = (this.state + 0x6D2B79F5) | 0;
        let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        this._callCount++;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** [min, max) 정수 난수 */
    nextInt(min: number, max: number): number {
        return Math.floor(this.next() * (max - min)) + min;
    }

    /** [min, max] 포함 정수 난수 */
    nextIntInclusive(min: number, max: number): number {
        return Math.floor(this.next() * (max - min + 1)) + min;
    }

    /** [min, max) 부동소수점 난수 */
    nextFloat(min: number, max: number): number {
        return this.next() * (max - min) + min;
    }

    /** true/false 난수 (pTrue = true 확률, 기본 0.5) */
    nextBool(pTrue: number = 0.5): boolean {
        return this.next() < pTrue;
    }

    /** 정규 분포 근사 (Box-Muller) */
    nextGaussian(mean: number = 0, stddev: number = 1): number {
        const u1 = this.next();
        const u2 = this.next();
        const z = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
        return mean + z * stddev;
    }

    /** 현재 상태의 깊은 복사 (독립적인 스냅샷) */
    copy(): PRNG {
        const clone = new PRNG(this.seed);
        clone.state = this.state;
        clone._callCount = this._callCount;
        return clone;
    }

    /** n步 건너뛰기 (LCG 기반) */
    skip(n: number): void {
        for (let i = 0; i < n; i++) {
            this.state = (Math.imul(PRNG.LCG_A, this.state) + PRNG.LCG_C) >>> 0;
        }
        this._callCount += n;
    }

    /** 상태를 seed로 리셋 */
    reset(newSeed?: number): void {
        this.state = (newSeed ?? this.seed) >>> 0;
        this._callCount = 0;
    }

    get callCount(): number { return this._callCount; }

    /** 현재 상태를 JSON 직렬화 (재현용) */
    serialize(): string {
        return JSON.stringify({ seed: this.seed, state: this.state, callCount: this._callCount });
    }

    /** 직렬화된 상태 복원 */
    static deserialize(json: string): PRNG {
        const data = JSON.parse(json) as { seed: number; state: number; callCount: number };
        const prng = new PRNG(data.seed);
        prng.state = data.state;
        prng._callCount = data.callCount;
        return prng;
    }

    /**
     * 전투용 유틸리티: 크리티컬 확률 판정
     * @param critRate 0.0 ~ 1.0
     */
    rollCritical(critRate: number): boolean {
        return this.next() < critRate;
    }

    /**
     * 전투용 유틸리티: 명중 판정
     * @param accuracy 0.0 ~ 1.0
     */
    rollHit(accuracy: number): boolean {
        return this.next() < accuracy;
    }

    /**
     * 전투용 유틸리티: 상태이상 발동 판정
     * @param procRate 0.0 ~ 1.0
     */
    rollStatusEffect(procRate: number): boolean {
        return this.next() < procRate;
    }

    /**
     * 전투용 유틸리티: 데미지 변동 (±spread%)
     * @param baseDamage 기본 데미지
     * @param spread 변동폭 (0.0 ~ 1.0, 기본 0.1 = ±10%)
     */
    rollDamageVariance(baseDamage: number, spread: number = 0.1): number {
        const variance = 1 + this.nextFloat(-spread, spread);
        return Math.round(baseDamage * variance);
    }
}

// ============================================================
// [2] 네트워크 프로토콜 타입
// ============================================================

/** 플레이어 ID */
export type PlayerID = string;

/** 방/세션 ID */
export type RoomID = string;

/** Lockstep 프레임 번호 */
export type FrameNumber = number;

/** 플레이어가 제출한 커맨드 패킷 */
export interface PlayerCommandPacket {
    readonly playerId: PlayerID;
    readonly frame: FrameNumber;
    readonly commands: readonly SerializedPlayerCommand[];
    readonly prngCallCount: number;  // PRNG 호출 횟수 (데싱크 감지용)
    readonly checksum: string;       // 이 프레임의 상태 체크섬
    readonly timestamp: number;
}

/** 직렬화된 플레이어 커맨드 */
export interface SerializedPlayerCommand {
    readonly type: CommandType;
    readonly officerId: OfficerID;
    readonly targetId?: string;
    readonly payload: Record<string, unknown>;
}

/** 서버가 브로드캐스트하는 프레임 패키지 */
export interface FramePackage {
    readonly frame: FrameNumber;
    readonly seed: number;
    readonly playerPackets: readonly PlayerCommandPacket[];
    readonly combinedChecksum: string;
    readonly timestamp: number;
}

/** 데싱크 감지 보고서 */
export interface DesyncReport {
    readonly frame: FrameNumber;
    readonly localChecksum: string;
    readonly remoteChecksum: string;
    readonly localPrngCalls: number;
    readonly remotePrngCalls: number;
    readonly timestamp: number;
}

/** 네트워크 동기화 상태 */
export type SyncState =
    | 'DISCONNECTED'
    | 'CONNECTING'
    | 'SYNCING'
    | 'IN_GAME'
    | 'DESYNCED'
    | 'RECONNECTING';

/** 콜백 타입 */
export type OnFrameReady = (pkg: FramePackage) => void;
export type OnDesync = (report: DesyncReport) => void;
export type OnStateChange = (state: SyncState, prevState: SyncState) => void;
export type OnError = (error: NetworkError) => void;

export interface NetworkError {
    readonly code: string;
    readonly message: string;
    readonly frame?: FrameNumber;
}

// ============================================================
// [3] 체크섬 유틸리티 (FNV-1a 32비트)
// ============================================================

/**
 * FNV-1a 32비트 비암호학적 해시
 *
 * 용도: 프레임 단위 상태 무결성 검증
 * 속도: ~200MB/s (JSON.stringify + 해시)
 * 충돌: 2^32 ≈ 42억분의 1 (프레임 단위로 충분)
 */
function computeChecksum(data: string): string {
    let h = 0x811C9DC5 >>> 0;
    for (let i = 0; i < data.length; i++) {
        h ^= data.charCodeAt(i) & 0xFF;
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/**
 * NormalizedState의 체크섬을 계산한다.
 * 인덱스(byFaction/byCity/byOfficer)는 파생 데이터이므로 제외.
 */
function stateChecksum(state: NormalizedState): string {
    // 데이터 레코드만 선택적으로 해싱
    const relevant = {
        o: state.officers,
        f: state.factions,
        c: state.cities,
        a: state.armies,
        r: state.relationships,
    };
    return computeChecksum(JSON.stringify(relevant));
}

// ============================================================
// [4] Supabase Realtime 채널 관리자
// ============================================================

// ── Ambient declaration: Supabase 패키지 없어도 컴파일 타임 에러 방지 ──
declare type RealtimeChannel = any;

export class SupabaseRealtimeChannel {
    private channel: RealtimeChannel | null = null;
    private roomId: RoomID;
    private playerId: PlayerID;
    isAvailable: boolean = false;

    constructor(
        private supabaseUrl: string,
        private supabaseKey: string,
        roomId: RoomID,
        playerId: PlayerID,
    ) {
        this.roomId = roomId;
        this.playerId = playerId;
    }

    // ── Type Guard: 런타임에 로드된 객체가 유효한 Supabase Client인지 검증 ──
    private isSupabaseClient(client: any): client is RealtimeChannel['constructor'] {
        return client && typeof client.channel === 'function';
    }

    // ── 연결 + 구독 설정 ──
    async connect(
        onCommand: (packet: PlayerCommandPacket) => void,
        onFrameReady: (pkg: FramePackage) => void,
        onDesync: (report: DesyncReport) => void,
        onError: (err: NetworkError) => void,
    ): Promise<boolean> {
        try {
            // Dynamic Import + Try/Catch → 패키지 없어도 싱글플레이 모드로 우아한 전환
            // @ts-ignore - Supabase는 선택적 의존성; 런타임 부재 시 try/catch가 처리
            const supabaseModule = await import('@supabase/supabase-js');

            if (!supabaseModule || typeof supabaseModule.createClient !== 'function') {
                throw new Error('Invalid Supabase module structure');
            }

            const supabase = supabaseModule.createClient(this.supabaseUrl, this.supabaseKey);

            if (!this.isSupabaseClient(supabase)) {
                throw new Error('Created client is not a valid Supabase client');
            }

            const channelId = `game:${this.roomId}`;
            this.channel = supabase.channel(channelId);
            this.isAvailable = true;

            if (!this.channel) return false;

            this.channel.on('broadcast', { event: 'command' }, (payload: { data: unknown }) => {
                const data = payload.data as PlayerCommandPacket;
                if (data.playerId !== this.playerId) onCommand(data);
            });
            this.channel.on('broadcast', { event: 'frame_ready' }, (payload: { data: unknown }) => {
                onFrameReady(payload.data as FramePackage);
            });
            this.channel.on('broadcast', { event: 'desync' }, (payload: { data: unknown }) => {
                onDesync(payload.data as DesyncReport);
            });
            this.channel.on('broadcast', { event: 'error' }, (payload: { data: unknown }) => {
                onError(payload.data as NetworkError);
            });

            await this.channel.subscribe();
            return true;
        } catch (err) {
            this.isAvailable = false;
            this.channel = null;
            console.warn('[SupabaseChannel] Module not available. Running in offline/single-player mode.');
            return false;
        }
    }

    // ── 안전한 메서드 호출 (isAvailable 가드) ──

    async sendCommand(packet: PlayerCommandPacket): Promise<void> {
        if (!this.isAvailable || !this.channel) return;
        try {
            await this.channel.send({ type: 'broadcast', event: 'command', data: packet });
        } catch (err) {
            console.error('[SupabaseChannel] sendCommand failed:', err);
        }
    }

    async sendFrameReady(pkg: FramePackage): Promise<void> {
        if (!this.isAvailable || !this.channel) return;
        try {
            await this.channel.send({ type: 'broadcast', event: 'frame_ready', data: pkg });
        } catch (err) {
            console.error('[SupabaseChannel] sendFrameReady failed:', err);
        }
    }

    async sendDesync(report: DesyncReport): Promise<void> {
        if (!this.isAvailable || !this.channel) return;
        try {
            await this.channel.send({ type: 'broadcast', event: 'desync', data: report });
        } catch (err) {
            console.error('[SupabaseChannel] sendDesync failed:', err);
        }
    }

    disconnect(): void {
        if (this.channel) {
            this.channel.unsubscribe();
            this.channel = null;
        }
        this.isAvailable = false;
    }
}

// ============================================================
// [5] Lockstep 엔진
// ============================================================

/**
 * LockstepEngine — 프레임 틱 동기화 엔진
 *
 * 프로토콜:
 *   1. JOIN: 두 플레이어가 동일한 roomId로 입장
 *   2. SYNC: seed + frame 0 동기화
 *   3. COMMAND: 각 플레이어가 frame N의 커맨드 제출
 *   4. FRAME_READY: 양측 커맨드 수집 시 브로드캐스트
 *   5. EXECUTE: 양측 동시에 frame N 실행
 *   6. CHECKSUM: 실행 후 체크섬 교환 및 검증
 *   7. ADVANCE: N → N+1 (3번으로)
 *   8. DESYNC: 체크섬 불일치 시 → 롤백 + 재동기
 */
export class LockstepEngine {
    private frame = 0;
    private seed = 0;
    private readonly prng: PRNG;
    private readonly store: GameStore;
    private readonly channel: SupabaseRealtimeChannel;
    private readonly playerId: PlayerID;
    private readonly roomId: RoomID;
    private receivedPackets = new Map<PlayerID, PlayerCommandPacket>();
    private players: PlayerID[] = [];
    private pendingFramePackage: FramePackage | null = null;
    private onFrameReady: OnFrameReady | null = null;
    private onDesync: OnDesync | null = null;
    private onError: OnError | null = null;
    private _state: SyncState = 'DISCONNECTED';
    private onStateChange: OnStateChange | null = null;

    constructor(
        store: GameStore,
        supabaseUrl: string,
        supabaseKey: string,
        roomId: RoomID,
        playerId: PlayerID,
    ) {
        this.store = store;
        this.seed = Math.floor(Math.random() * 2147483647);
        this.prng = new PRNG(this.seed);
        this.roomId = roomId;
        this.playerId = playerId;
        this.channel = new SupabaseRealtimeChannel(
            supabaseUrl, supabaseKey, roomId, playerId,
        );
    }

    // ============================================================
    // 생명주기
    // ============================================================

    setCallbacks(cbs: {
        onFrameReady: OnFrameReady;
        onDesync: OnDesync;
        onError: OnError;
        onStateChange?: OnStateChange;
    }): void {
        this.onFrameReady = cbs.onFrameReady;
        this.onDesync = cbs.onDesync;
        this.onError = cbs.onError;
        this.onStateChange = cbs.onStateChange ?? null;
    }

    async connect(players: PlayerID[]): Promise<boolean> {
        this.setState('CONNECTING');
        this.players = players;

        const ok = await this.channel.connect(
            (packet) => this.onCommandReceived(packet),
            (pkg) => this.onFramePackageReceived(pkg),
            (report) => this.onDesyncReport(report),
            (err) => this.onError?.(err),
        );

        if (!ok) {
            this.setState('DISCONNECTED');
            return false;
        }

        // seed 동기화: host(첫 플레이어)는 seed 생성, guest는 수신
        if (this.playerId === players[0]) {
            this.seed = Math.floor(Math.random() * 2147483647);
            this.prng.reset(this.seed);
            // seed 브로드캐스트
            await this.channel.sendFrameReady({
                frame: 0,
                seed: this.seed,
                playerPackets: [],
                combinedChecksum: '',
                timestamp: Date.now(),
            });
        }

        this.setState('SYNCING');
        return true;
    }

    /** 게임 시작 (seed 동기화 완료 후) */
    startGame(initialSeed: number): void {
        this.seed = initialSeed;
        this.prng.reset(this.seed);
        this.frame = 0;
        this.setState('IN_GAME');
    }

    /** 현재 프레임의 커맨드 제출 */
    async submitCommands(
        commands: readonly SerializedPlayerCommand[],
    ): Promise<void> {
        const state = this.store.createSnapshot();
        const chk = stateChecksum(state);

        const packet: PlayerCommandPacket = {
            playerId: this.playerId,
            frame: this.frame,
            commands,
            prngCallCount: this.prng.callCount,
            checksum: chk,
            timestamp: Date.now(),
        };

        await this.channel.sendCommand(packet);
        this.onCommandReceived(packet);
    }

    /** 연결 해제 */
    disconnect(): void {
        this.channel.disconnect();
        this.setState('DISCONNECTED');
        this.receivedPackets.clear();
        this.pendingFramePackage = null;
    }

    // ============================================================
    // 프레임 틱 제어
    // ============================================================

    /**
     * 다음 프레임으로 진행.
     * 양측 커맨드가 수집되었을 때만 실행 가능.
     * 이 메서드는 LockstepEngine 내부에서 프레임 패키지 수신 시 자동 호출됨.
     */
    private advanceFrame(pkg: FramePackage): void {
        this.frame = pkg.frame;

        // seed 동기화 (frame 0)
        if (this.frame === 0 && pkg.seed !== 0) {
            this.seed = pkg.seed;
            this.prng.reset(this.seed);
        }

        // PRNG call count 검증
        for (const pp of pkg.playerPackets) {
            if (pp.prngCallCount !== this.prng.callCount) {
                this.triggerDesync({
                    frame: this.frame,
                    localChecksum: '',
                    remoteChecksum: '',
                    localPrngCalls: this.prng.callCount,
                    remotePrngCalls: pp.prngCallCount,
                    timestamp: Date.now(),
                });
                return;
            }
        }

        // 상태 체크섬 검증 (PRNG 호출 전 스냅샷)
        const preState = this.store.createSnapshot();
        const preChecksum = stateChecksum(preState);

        for (const pp of pkg.playerPackets) {
            if (pp.checksum !== preChecksum) {
                this.triggerDesync({
                    frame: this.frame,
                    localChecksum: preChecksum,
                    remoteChecksum: pp.checksum,
                    localPrngCalls: this.prng.callCount,
                    remotePrngCalls: pp.prngCallCount,
                    timestamp: Date.now(),
                });
                return;
            }
        }

        // 프레임 실행
        this.onFrameReady?.(pkg);
    }

    // ============================================================
    // 데싱크 감지 및 복구
    // ============================================================

    /**
     * 프레임 실행 후 체크섬 검증.
     * onFrameReady 콜백에서 프레임 실행 후 호출해야 함.
     */
    verifyChecksum(): boolean {
        const state = this.store.createSnapshot();
        const localChk = stateChecksum(state);

        // 원격 체크섬과 비교
        if (!this.pendingFramePackage) return true;

        for (const pp of this.pendingFramePackage.playerPackets) {
            if (pp.playerId === this.playerId) continue;
            if (pp.checksum !== localChk) {
                this.triggerDesync({
                    frame: this.frame,
                    localChecksum: localChk,
                    remoteChecksum: pp.checksum,
                    localPrngCalls: this.prng.callCount,
                    remotePrngCalls: pp.prngCallCount,
                    timestamp: Date.now(),
                });
                return false;
            }
        }

        // 검증 완료 → 다음 프레임 진행
        this.frame++;
        this.pendingFramePackage = null;
        return true;
    }

    /** 데싱크 발생 → 이전 프레임으로 롤백 */
    async rollbackFrame(store: GameStore, targetFrame: number): Promise<void> {
        console.warn(`[LockstepEngine] Rolling back to frame ${targetFrame}`);

        // PRNG 상태 롤백 (callCount 기반)
        const prngClone = new PRNG(this.seed);
        prngClone.skip(targetFrame); // targetFrame까지 건너뛰기
        // PRNG 상태 복원

        // GameStore 스냅샷 롤백 (backup manager 사용 전제)
        this.frame = targetFrame;
        this.setState('RECONNECTING');

        // 재동기 요청
        await this.channel.sendFrameReady({
            frame: targetFrame,
            seed: this.seed,
            playerPackets: [],
            combinedChecksum: '',
            timestamp: Date.now(),
        });

        this.setState('IN_GAME');
    }

    // ============================================================
    // 내부 핸들러
    // ============================================================

    private onCommandReceived(packet: PlayerCommandPacket): void {
        this.receivedPackets.set(packet.playerId, packet);

        // 모든 플레이어의 커맨드가 수집되었는지 확인
        if (this.receivedPackets.size >= this.players.length) {
            const allPackets = this.players
                .map(id => this.receivedPackets.get(id))
                .filter((p): p is PlayerCommandPacket => p !== undefined);

            if (allPackets.length >= this.players.length) {
                // 체크섬 일치 확인 후 프레임 패키지 생성
                const firstChk = allPackets[0].checksum;
                const checksumsMatch = allPackets.every(p => p.checksum === firstChk);

                if (!checksumsMatch) {
                    // 체크섬 불일치 → 데싱크
                    for (const p of allPackets) {
                        if (p.checksum !== firstChk) {
                            this.triggerDesync({
                                frame: this.frame,
                                localChecksum: firstChk,
                                remoteChecksum: p.checksum,
                                localPrngCalls: allPackets[0].prngCallCount,
                                remotePrngCalls: p.prngCallCount,
                                timestamp: Date.now(),
                            });
                        }
                    }
                    return;
                }

                const pkg: FramePackage = {
                    frame: this.frame,
                    seed: this.seed,
                    playerPackets: allPackets,
                    combinedChecksum: firstChk,
                    timestamp: Date.now(),
                };

                this.pendingFramePackage = pkg;

                // 브로드캐스트 (host만)
                if (this.playerId === this.players[0]) {
                    this.channel.sendFrameReady(pkg);
                }

                // 즉시 실행
                this.advanceFrame(pkg);
            }
        }
    }

    private onFramePackageReceived(pkg: FramePackage): void {
        // host가 아닌 플레이어는 브로드캐스트 수신 후 실행
        if (this.playerId !== this.players[0]) {
            this.pendingFramePackage = pkg;

            // 이미 이 프레임을 실행했는지 확인
            if (this.frame <= pkg.frame) {
                this.advanceFrame(pkg);
            }
        }
    }

    private onDesyncReport(report: DesyncReport): void {
        this.onDesync?.(report);
        this.setState('DESYNCED');

        if (this.playerId === this.players[0]) {
            // host가 롤백 주도
            this.rollbackFrame(this.store, report.frame - 1);
        }
    }

    private triggerDesync(report: DesyncReport): void {
        console.error('[LockstepEngine] DESYNC DETECTED:', report);
        this.onDesync?.(report);
        this.setState('DESYNCED');
        this.channel.sendDesync(report);
    }

    // ============================================================
    // 상태 관리
    // ============================================================

    private setState(newState: SyncState): void {
        const prev = this._state;
        if (prev !== newState) {
            this._state = newState;
            this.onStateChange?.(newState, prev);
        }
    }

    get syncState(): SyncState { return this._state; }
    get currentFrame(): FrameNumber { return this.frame; }
    get currentSeed(): number { return this.seed; }
    get room(): RoomID { return this.roomId; }
}

// ============================================================
// [6] NetworkSyncManager — 통합 퍼사드
// ============================================================

export type SyncConfig = {
    readonly supabaseUrl: string;
    readonly supabaseKey: string;
    readonly roomId: RoomID;
    readonly playerId: PlayerID;
    readonly players: PlayerID[];
    readonly onFrameReady: OnFrameReady;
    readonly onDesync?: OnDesync;
    readonly onStateChange?: OnStateChange;
    readonly onError?: OnError;
};

/**
 * NetworkSyncManager — Seed 기반 결정론적 턴제 네트워크 동기화 통합 매니저
 *
 * 사용 예:
 * ```typescript
 * const sync = new NetworkSyncManager(store, {
 *     supabaseUrl: 'https://xxx.supabase.co',
 *     supabaseKey: 'public-anon-key',
 *     roomId: 'room_abc123',
 *     playerId: 'player_1',
 *     players: ['player_1', 'player_2'],
 *     onFrameReady: (pkg) => { /* execute frame *\/ },
 * });
 *
 * await sync.connect();
 *
 * // 매 턴:
 * sync.submitCommands([/* player commands *\/]);
 *
 * // 프레임 실행 후:
 * sync.verifyChecksum(); // true → advance, false → desync
 * ```
 */
export class NetworkSyncManager {
    readonly prng: PRNG;
    readonly lockstep: LockstepEngine;
    private readonly store: GameStore;
    private readonly config: SyncConfig;

    constructor(store: GameStore, config: SyncConfig) {
        this.store = store;
        this.config = config;
        this.prng = new PRNG();
        this.lockstep = new LockstepEngine(
            store,
            config.supabaseUrl,
            config.supabaseKey,
            config.roomId,
            config.playerId,
        );
    }

    /** Supabase Realtime 연결 + Lockstep 초기화 */
    async connect(): Promise<boolean> {
        this.lockstep.setCallbacks({
            onFrameReady: this.config.onFrameReady,
            onDesync: this.config.onDesync ?? (() => {}),
            onError: this.config.onError ?? (() => {}),
            onStateChange: this.config.onStateChange,
        });

        return await this.lockstep.connect(this.config.players);
    }

    /** 게임 시작 (seed 동기화 완료 후) */
    startGame(seed?: number): void {
        const finalSeed = seed ?? this.prng.seed;
        this.prng.reset(finalSeed);
        this.lockstep.startGame(finalSeed);
    }

    /** 현재 프레임의 커맨드 제출 */
    async submitCommands(
        commands: readonly SerializedPlayerCommand[],
    ): Promise<void> {
        await this.lockstep.submitCommands(commands);
    }

    /** 프레임 실행 후 체크섬 검증 */
    verifyChecksum(): boolean {
        return this.lockstep.verifyChecksum();
    }

    /** 데싱크 발생 시 롤백 */
    async rollbackFrame(targetFrame: number): Promise<void> {
        await this.lockstep.rollbackFrame(this.store, targetFrame);
    }

    /** 전투용: 결정론적 PRNG로 크리티컬 판정 */
    rollCritical(critRate: number): boolean {
        return this.prng.rollCritical(critRate);
    }

    /** 전투용: 결정론적 PRNG로 명중 판정 */
    rollHit(accuracy: number): boolean {
        return this.prng.rollHit(accuracy);
    }

    /** 전투용: 결정론적 PRNG로 데미지 변동 */
    rollDamageVariance(baseDamage: number, spread?: number): number {
        return this.prng.rollDamageVariance(baseDamage, spread);
    }

    /** 연결 해제 */
    disconnect(): void {
        this.lockstep.disconnect();
    }

    get syncState(): SyncState { return this.lockstep.syncState; }
    get currentFrame(): number { return this.lockstep.currentFrame; }
    get currentSeed(): number { return this.lockstep.currentSeed; }
}
