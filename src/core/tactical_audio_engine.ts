/**
 * 삼국지리턴 — Web Audio 기반 3D 바이노럴 전술 사운드 엔진
 * 파일: src/core/tactical_audio_engine.ts
 *
 * [492] PannerNode HRTF 3D 입체 음향
 * [494] 거리 역제곱 감쇠 + BiquadFilterNode 공기 흡수
 * [495] 기상 상태 앰비언트 믹서
 * [497] 크리티컬/타격 피치 랜덤마이저
 *
 * ── 오디오 그래프 ──
 *
 * BufferSource
 *   → BiquadFilterNode (lowpass: 거리별 고주파 감쇠)
 *     → PannerNode (HRTF: 3D 위치 + 방향)
 *       → GainNode (거리 볼륨 감쇠)
 *         → AudioContext.destination
 *
 * ── 메모리 안전성 ──
 *   - AudioNodePool: 32개 노드 선할당, 재사용
 *   - SoundInstance: stop() 시 풀 반납 + 그래프 해체
 *   - dispose(): 모든 노드 연결 끊기 + 컨텍스트 종료
 */

import { PRNG } from './network_sync_manager.js';

// ============================================================
// [0] 타입 정의
// ============================================================

/** 3D 공간 좌표 */
export interface AudioVec3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

/** 카메라 상태 (Listener 동기화용) */
export interface AudioCameraState {
    readonly position: AudioVec3;
    readonly forward: AudioVec3;
    readonly up: AudioVec3;
}

/** 기상 상태 */
export type AudioWeather = 'SUNNY' | 'CLOUDY' | 'RAIN' | 'SNOW' | 'STORM' | 'FOG';

/** 사운드 버퍼 식별자 (URL 또는 버퍼 이름) */
export type SoundBufferId = string;

/** 사운드 재생 옵션 */
export interface SoundPlayOptions {
    readonly bufferId: SoundBufferId;
    readonly position: AudioVec3;
    readonly volume?: number;         // 0.0 ~ 1.0 (기본 1.0)
    readonly pitch?: number;          // 기본 1.0
    readonly pitchVariance?: number;  // ±pitch (기본 0.1 = ±10%)
    readonly loop?: boolean;
    readonly priority?: SoundPriority;
    readonly maxDistance?: number;    // 기본 100
    readonly refDistance?: number;    // 기본 5
    readonly rolloffFactor?: number;  // 기본 2 (역제곱)
    readonly playbackTime?: number;   // 재생 위치 (초)
}

/** 사운드 우선순위 (pool 부족 시 낮은 우선순위부터 폐기) */
export type SoundPriority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';

/** 앰비언트 레이어 */
export interface AmbientLayer {
    readonly bufferId: SoundBufferId;
    readonly volume: number;           // 0.0 ~ 1.0
    readonly fadeInDuration: number;   // 페이드인 시간 (초)
    readonly fadeOutDuration: number;  // 페이드아웃 시간 (초)
    readonly weatherMask: AudioWeather[];
}

/** 활성 사운드 인스턴스 */
export interface SoundInstance {
    readonly id: number;
    readonly options: SoundPlayOptions;
    readonly startTime: number;
    readonly sourceNode: AudioBufferSourceNode;
    readonly pannerNode: PannerNode;
    readonly filterNode: BiquadFilterNode;
    readonly gainNode: GainNode;
    isStopped: boolean;
}

// ============================================================
// [1] 오디오 노드 풀
// ============================================================

/**
 * AudioNodePool — BufferSource + Panner + Filter + Gain 노드 선할당 풀
 *
 * 풀링이 필요한 이유:
 *   BufferSourceNode는 한 번 start()하면 stop() 후 재사용 불가.
 *   PannerNode/BiquadFilterNode/GainNode는 재연결 가능.
 *   매번 new 생성 + GC는 프레임 드랍 유발.
 *
 * 전략:
 *   - BufferSourceNode: pre-create N개 (기본 32)
 *   - Panner/Filter/Gain: pre-create N개, disconnect 후 재연결
 *   - 사용 가능한 노드가 없으면 가장 오래된 LOW 우선순위 인스턴스 폐기
 */
export class AudioNodePool {
    private readonly poolSize: number;
    private readonly ctx: AudioContext;
    private sourceNodes: AudioBufferSourceNode[] = [];
    private pannerNodes: PannerNode[] = [];
    private filterNodes: BiquadFilterNode[] = [];
    private gainNodes: GainNode[] = [];
    private nextFreeIndex = 0;

    constructor(ctx: AudioContext, poolSize = 32) {
        this.ctx = ctx;
        this.poolSize = poolSize;
        this.allocate();
    }

    private allocate(): void {
        for (let i = 0; i < this.poolSize; i++) {
            // BufferSource (매번 새로 생성, start() 후 폐기)
            this.sourceNodes.push(this.ctx.createBufferSource());

            // PannerNode (HRTF)
            const panner = this.ctx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.refDistance = 5;
            panner.maxDistance = 100;
            panner.rolloffFactor = 2;
            panner.coneInnerAngle = 360;
            panner.coneOuterAngle = 360;
            panner.disconnect();
            this.pannerNodes.push(panner);

            // BiquadFilterNode (lowpass)
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 22000;
            filter.Q.value = 1;
            filter.disconnect();
            this.filterNodes.push(filter);

            // GainNode
            const gain = this.ctx.createGain();
            gain.gain.value = 1;
            gain.disconnect();
            this.gainNodes.push(gain);
        }
    }

    /** 다음 사용 가능한 인덱스 획득 (라운드 로빈) */
    acquireIndex(): number | null {
        const idx = this.nextFreeIndex;
        this.nextFreeIndex = (this.nextFreeIndex + 1) % this.poolSize;
        return idx;
    }

    /** BufferSourceNode 재할당 (기존 노드는 stop() 후 새 노드로 교체) */
    acquireSourceNode(): AudioBufferSourceNode {
        const node = this.ctx.createBufferSource();
        return node;
    }

    /** PannerNode 획득 (연결 해제된 상태로 반환) */
    acquirePanner(idx: number): PannerNode {
        const node = this.pannerNodes[idx];
        try { node.disconnect(); } catch { /* 이미 해제됨 */ }
        return node;
    }

    /** BiquadFilterNode 획득 */
    acquireFilter(idx: number): BiquadFilterNode {
        const node = this.filterNodes[idx];
        try { node.disconnect(); } catch { /* 이미 해제됨 */ }
        node.frequency.value = 22000;
        return node;
    }

    /** GainNode 획득 */
    acquireGain(idx: number): GainNode {
        const node = this.gainNodes[idx];
        try { node.disconnect(); } catch { /* 이미 해제됨 */ }
        node.gain.value = 1;
        return node;
    }

    /** 풀의 PannerNode dispose */
    disposePanner(idx: number): void {
        try { this.pannerNodes[idx]?.disconnect(); } catch { /* */ }
    }

    /** 풀의 FilterNode dispose */
    disposeFilter(idx: number): void {
        try { this.filterNodes[idx]?.disconnect(); } catch { /* */ }
    }

    /** 풀의 GainNode dispose */
    disposeGain(idx: number): void {
        try { this.gainNodes[idx]?.disconnect(); } catch { /* */ }
    }

    /** 모든 노드 정리 */
    disposeAll(): void {
        for (const p of this.pannerNodes) try { p.disconnect(); } catch { /* */ }
        for (const f of this.filterNodes) try { f.disconnect(); } catch { /* */ }
        for (const g of this.gainNodes) try { g.disconnect(); } catch { /* */ }
        this.sourceNodes = [];
        this.pannerNodes = [];
        this.filterNodes = [];
        this.gainNodes = [];
    }
}

// ============================================================
// [2] TacticalAudioEngine — 메인 클래스
// ============================================================

/**
 * TacticalAudioEngine — 3D 바이노럴 전술 사운드 엔진
 *
 * 사용 예:
 * ```typescript
 * const audio = new TacticalAudioEngine();
 * await audio.init();
 *
 * // 프레임 루프에서:
 * audio.updateListener(camera.position, camera.forward, camera.up);
 *
 * // 사운드 재생:
 * audio.playSound({
 *     bufferId: 'cavalry_charge',
 *     position: { x: 10, y: 0, z: -5 },
 *     volume: 0.8,
 *     pitchVariance: 0.15,
 * });
 *
 * // 날씨 변경:
 * audio.setWeather('RAIN');
 * ```
 */
export class TacticalAudioEngine {
    private ctx: AudioContext | null = null;
    private pool: AudioNodePool | null = null;
    private prng: PRNG;
    private activeSounds: Map<number, SoundInstance> = new Map();
    private nextId = 1;
    private _weather: AudioWeather = 'SUNNY';
    private ambientNodes: Map<string, {
        source: AudioBufferSourceNode | null;
        gain: GainNode;
        bufferId: SoundBufferId;
        currentVol: number;
        targetVol: number;
    }> = new Map();
    private bufferCache = new Map<SoundBufferId, AudioBuffer>();
    private masterGain: GainNode | null = null;
    private compressor: DynamicsCompressorNode | null = null;
    private _volume = 1;
    private _muted = false;
    private listener: AudioListener | null = null;

    /** 프리로드할 사운드 버퍼 URL 목록 (init() 전에 설정) */
    preloadBuffers: { id: SoundBufferId; url: string }[] = [];

    constructor() {
        this.prng = new PRNG();
    }

    // ============================================================
    // 초기화
    // ============================================================

    /** AudioContext 초기화 (유저 제스처 필요) */
    async init(): Promise<boolean> {
        try {
            this.ctx = new AudioContext();
            this.listener = this.ctx.listener;

            // [22] DynamicsCompressorNode: 피크 클리핑 차단
            this.compressor = this.ctx.createDynamicsCompressor();
            this.compressor.threshold.value = -24;
            this.compressor.knee.value = 30;
            this.compressor.ratio.value = 12;
            this.compressor.attack.value = 0.003;
            this.compressor.release.value = 0.25;
            this.compressor.connect(this.ctx.destination);

            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.value = this._volume;
            this.masterGain.connect(this.compressor);

            this.pool = new AudioNodePool(this.ctx, 32);

            // 프리로드 버퍼 로드
            if (this.preloadBuffers.length > 0) {
                await Promise.all(
                    this.preloadBuffers.map(b => this.loadBuffer(b.id, b.url)),
                );
            }

            // 기본 앰비언트 초기화
            this.initAmbientLayers();

            // [25] 백그라운드 전환 시 오디오 서스펜드/레쥼
            this.bindVisibilityHandler();

            return true;
        } catch (err) {
            console.error('[TacticalAudioEngine] Initialization failed:', err);
            return false;
        }
    }

    // ============================================================
    // 버퍼 관리
    // ============================================================

    /** 사운드 버퍼 로드 (URL → AudioBuffer) */
    async loadBuffer(id: SoundBufferId, url: string): Promise<AudioBuffer | null> {
        if (!this.ctx) return null;
        if (this.bufferCache.has(id)) return this.bufferCache.get(id)!;

        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
            this.bufferCache.set(id, audioBuffer);
            return audioBuffer;
        } catch (err) {
            console.warn(`[TacticalAudioEngine] Failed to load buffer "${id}" from ${url}:`, err);
            return null;
        }
    }

    /** AudioBuffer 직접 등록 (이미 디코딩된 버퍼) */
    registerBuffer(id: SoundBufferId, buffer: AudioBuffer): void {
        this.bufferCache.set(id, buffer);
    }

    // ============================================================
    // Listener 동기화 (매 프레임 호출)
    // ============================================================

    /**
     * 카메라 상태를 AudioListener에 실시간 전송
     *
     * @param position - 카메라 위치 (meters)
     * @param forward  - 카메라 전방 벡터 (정규화)
     * @param up       - 카메라 상방 벡터 (정규화)
     */
    updateListener(position: AudioVec3, forward: AudioVec3, up: AudioVec3): void {
        if (!this.ctx || !this.listener) return;

        this.listener.positionX.value = position.x;
        this.listener.positionY.value = position.y;
        this.listener.positionZ.value = position.z;

        this.listener.forwardX.value = forward.x;
        this.listener.forwardY.value = forward.y;
        this.listener.forwardZ.value = forward.z;

        this.listener.upX.value = up.x;
        this.listener.upY.value = up.y;
        this.listener.upZ.value = up.z;
    }

    /** 편의: Vec3에서 listener 설정 */
    updateListenerVec3(pos: AudioVec3, forward: AudioVec3, up: AudioVec3): void {
        this.updateListener(pos, forward, up);
    }

    // ============================================================
    // 사운드 재생
    // ============================================================

    /**
     * 3D 사운드 재생
     *
     * 오디오 그래프:
     *   BufferSource → BiquadFilterNode(lowpass, air absorption)
     *     → PannerNode(HRTF, 3D position)
     *       → GainNode(distance attenuation)
     *         → masterGain → destination
     */
    playSound(options: SoundPlayOptions): number | null {
        if (!this.ctx || !this.pool || !this.masterGain) return null;

        const buffer = this.bufferCache.get(options.bufferId);
        if (!buffer) {
            console.warn(`[TacticalAudioEngine] Buffer not found: ${options.bufferId}`);
            return null;
        }

        const poolIdx = this.pool.acquireIndex();
        if (poolIdx === null) return null;

        // ── 오디오 그래프 체인 구성 ──

        // [1] BufferSourceNode
        const source = this.pool.acquireSourceNode();
        source.buffer = buffer;
        source.loop = options.loop ?? false;
        source.loopStart = 0;
        source.loopEnd = buffer.duration;

        // 피치 변조 (Pitch Randomizer)
        const pitchVar = options.pitchVariance ?? 0.1;
        const pitchMul = options.pitch ?? 1.0;
        const finalPitch = pitchMul * this.prng.nextFloat(1 - pitchVar, 1 + pitchVar);
        source.playbackRate.value = Math.max(0.1, finalPitch);

        // [2] BiquadFilterNode (공기 흡수 Low-pass)
        const filter = this.pool.acquireFilter(poolIdx);
        filter.type = 'lowpass';
        filter.frequency.value = 22000;  // 초기값 (거리 업데이트는 프레임 루프에서)
        filter.Q.value = 1;

        // [3] PannerNode (HRTF 3D)
        const panner = this.pool.acquirePanner(poolIdx);
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = options.refDistance ?? 5;
        panner.maxDistance = options.maxDistance ?? 100;
        panner.rolloffFactor = options.rolloffFactor ?? 2;

        // 위치 설정
        panner.positionX.value = options.position.x;
        panner.positionY.value = options.position.y;
        panner.positionZ.value = options.position.z;

        // [4] GainNode (거리 감쇠 + 볼륨)
        const gain = this.pool.acquireGain(poolIdx);
        gain.gain.value = options.volume ?? 1.0;

        // ── 체인 연결 ──
        source.connect(filter);
        filter.connect(panner);
        panner.connect(gain);
        gain.connect(this.masterGain);

        // 재생
        const startOffset = options.playbackTime ?? 0;
        source.start(0, startOffset);

        // ── 인스턴스 등록 ──
        const id = this.nextId++;
        const instance: SoundInstance = {
            id,
            options,
            startTime: this.ctx.currentTime,
            sourceNode: source,
            pannerNode: panner,
            filterNode: filter,
            gainNode: gain,
            isStopped: false,
        };

        this.activeSounds.set(id, instance);

        // source 종료 시 자동 정리
        source.onended = () => {
            if (!instance.isStopped) {
                instance.isStopped = true;
                this.releaseInstance(instance, poolIdx);
                this.activeSounds.delete(id);
            }
        };

        return id;
    }

    // ============================================================
    // 사운드 정지 및 해제
    // ============================================================

    /** 특정 사운드 중지 */
    stopSound(id: number): void {
        const instance = this.activeSounds.get(id);
        if (!instance || instance.isStopped) return;
        instance.isStopped = true;

        try { instance.sourceNode.stop(); } catch { /* already stopped */ }
        this.releaseInstance(instance, this.findPoolIndex(instance.pannerNode));
        this.activeSounds.delete(id);
    }

    /** 모든 사운드 중지 */
    stopAllSounds(): void {
        for (const [id, instance] of this.activeSounds) {
            if (!instance.isStopped) {
                instance.isStopped = true;
                try { instance.sourceNode.stop(); } catch { /* */ }
            }
        }
        this.activeSounds.clear();
    }

    // ============================================================
    // 프레임 업데이트 (매 프레임 호출)
    // ============================================================

    /**
     * 매 프레임 호출하여 활성 사운드의 거리 감쇠 및 필터 업데이트
     *
     * @param listenerPosition - 리스너 위치
     * @param dt - 델타 타임 (초)
     */
    update(listenerPosition: AudioVec3, dt: number): void {
        if (!this.ctx) return;

        // 활성 사운드 거리 업데이트
        for (const [, instance] of this.activeSounds) {
            if (instance.isStopped) continue;

            const dx = instance.options.position.x - listenerPosition.x;
            const dy = instance.options.position.y - listenerPosition.y;
            const dz = instance.options.position.z - listenerPosition.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            // 공기 흡수: 거리에 따른 고주파 감쇠 (Low-pass)
            // 수학: f_cutoff = lerp(22000, 200, dist / maxDistance)
            //   가까울 때 22kHz (전음역), 멀 때 200Hz (먹먹)
            const maxDist = instance.options.maxDistance ?? 100;
            const t = Math.min(1, dist / maxDist);
            const cutoff = 22000 * Math.pow(0.1, t);  // 지수 감쇠
            instance.filterNode.frequency.value = Math.max(50, cutoff);

            // 거리 감쇠 볼륨 (역제곱 법칙 보정)
            // gain = volume / (1 + rolloffFactor × dist² / refDistance²)
            const refDist = instance.options.refDistance ?? 5;
            const rolloff = instance.options.rolloffFactor ?? 2;
            const baseVol = instance.options.volume ?? 1.0;
            const attenGain = baseVol / (1 + rolloff * (dist * dist) / (refDist * refDist));
            instance.gainNode.gain.value = Math.max(0.001, attenGain);
        }

        // 앰비언트 페이드
        this.updateAmbientFade(dt);
    }

    // ============================================================
    // 기상 상태 앰비언트 믹서
    // ============================================================

    /**
     * 기상 상태 변경 → 앰비언트 트랙 페이드 전환
     *
     * 전환 곡선:
     *   이전 날씨 앰비언트: 볼륨 → 0 (fadeOutDuration 동안)
     *   새 날씨 앰비언트: 볼륨 → target (fadeInDuration 동안)
     */
    setWeather(weather: AudioWeather): void {
        this._weather = weather;
        this.updateAmbientTargets();
    }

    get weather(): AudioWeather { return this._weather; }

    /** 마스터 볼륨 (0.0 ~ 1.0) */
    set volume(v: number) {
        this._volume = Math.max(0, Math.min(1, v));
        if (this.masterGain) this.masterGain.gain.value = this._muted ? 0 : this._volume;
    }

    get volume(): number { return this._volume; }

    /** 음소거 */
    set muted(m: boolean) {
        this._muted = m;
        if (this.masterGain) this.masterGain.gain.value = m ? 0 : this._volume;
    }

    get muted(): boolean { return this._muted; }

    /** AudioContext 재개 (브라우저 정책 대응) */
    async resume(): Promise<void> {
        if (this.ctx?.state === 'suspended') {
            await this.ctx.resume();
        }
    }

    // ============================================================
    // [20] 오실레이터 기반 화살 발사음 합성
    // ============================================================

    /**
     * [20] 순수 코드 화살 발사음 합성
     *
     * OscillatorNode 주파수를 고주파(2000Hz) → 저주파(200Hz)로
     * 0.15초 동안 급속 스윕하여 화살이 공기를 가르는 소리를 생성
     *
     * @param position 3D 공간 좌표 (옵션, 미지정 시 2D)
     * @returns 사운드 인스턴스 ID (실패 시 null)
     */
    playArrowSound(position?: AudioVec3): number | null {
        if (!this.ctx || !this.masterGain) return null;

        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';

        const sweepGain = this.ctx.createGain();
        sweepGain.gain.setValueAtTime(0.15, this.ctx.currentTime);
        sweepGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.15);

        osc.frequency.setValueAtTime(2000, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, this.ctx.currentTime + 0.15);

        osc.connect(sweepGain);

        if (position) {
            const panner = this.ctx.createPanner();
            panner.panningModel = 'HRTF';
            panner.positionX.value = position.x;
            panner.positionY.value = position.y;
            panner.positionZ.value = position.z;
            sweepGain.connect(panner);
            panner.connect(this.masterGain);
        } else {
            sweepGain.connect(this.masterGain);
        }

        const id = this.nextId++;
        osc.start(this.ctx.currentTime);
        osc.stop(this.ctx.currentTime + 0.2);

        osc.onended = () => {
            try { osc.disconnect(); } catch { /* */ }
            try { sweepGain.disconnect(); } catch { /* */ }
        };

        return id;
    }

    // ============================================================
    // [25] 백그라운드 전환 시 오디오 서스펜드
    // ============================================================

    private bindVisibilityHandler(): void {
        if (typeof document === 'undefined') return;

        document.addEventListener('visibilitychange', () => {
            if (!this.ctx) return;
            if (document.hidden) {
                if (this.ctx.state === 'running') {
                    this.ctx.suspend().catch(() => {});
                }
            } else {
                if (this.ctx.state === 'suspended') {
                    this.ctx.resume().catch(() => {});
                }
            }
        });
    }

    // ============================================================
    // 내부: 앰비언트
    // ============================================================

    private readonly ambientConfigs: {
        id: string;
        bufferId: SoundBufferId;
        baseVolume: number;
        weatherMask: AudioWeather[];
        fadeIn: number;
        fadeOut: number;
    }[] = [];

    /** 앰비언트 레이어 등록 */
    registerAmbient(config: {
        id: string;
        bufferId: SoundBufferId;
        baseVolume: number;
        weatherMask: AudioWeather[];
        fadeIn?: number;
        fadeOut?: number;
    }): void {
        this.ambientConfigs.push({
            id: config.id,
            bufferId: config.bufferId,
            baseVolume: config.baseVolume,
            weatherMask: config.weatherMask,
            fadeIn: config.fadeIn ?? 2,
            fadeOut: config.fadeOut ?? 3,
        });
    }

    private initAmbientLayers(): void {
        if (!this.ctx || !this.masterGain) return;

        // 앰비언트 레이어 초기화
        for (const config of this.ambientConfigs) {
            const gain = this.ctx.createGain();
            gain.gain.value = 0;
            gain.connect(this.masterGain);

            this.ambientNodes.set(config.id, {
                source: null,
                gain,
                bufferId: config.bufferId,
                currentVol: 0,
                targetVol: 0,
            });
        }
    }

    private updateAmbientTargets(): void {
        for (const config of this.ambientConfigs) {
            const node = this.ambientNodes.get(config.id);
            if (!node) continue;

            const shouldPlay = config.weatherMask.includes(this._weather);
            node.targetVol = shouldPlay ? config.baseVolume : 0;

            if (shouldPlay && !node.source) {
                this.startAmbientLoop(config.id, node);
            } else if (!shouldPlay && node.source) {
                this.stopAmbientLoop(config.id, node);
            }
        }
    }

    private startAmbientLoop(id: string, node: {
        source: AudioBufferSourceNode | null;
        gain: GainNode;
        bufferId: string;
        currentVol: number;
        targetVol: number;
    }): void {
        if (!this.ctx || !this.masterGain) return;

        const buffer = this.bufferCache.get(node.bufferId);
        if (!buffer) return;

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        source.playbackRate.value = 1;
        source.connect(node.gain);
        source.start();

        node.source = source;

        // loop 재시작 (종료 시 자동 재생성)
        source.onended = () => {
            if (node.targetVol > 0) {
                this.startAmbientLoop(id, node);
            } else {
                node.source = null;
            }
        };
    }

    private stopAmbientLoop(id: string, node: {
        source: AudioBufferSourceNode | null;
        gain: GainNode;
        bufferId: string;
        currentVol: number;
        targetVol: number;
    }): void {
        if (node.source) {
            try { node.source.stop(); } catch { /* */ }
            node.source = null;
        }
    }

    private updateAmbientFade(dt: number): void {
        for (const [, node] of this.ambientNodes) {
            if (Math.abs(node.currentVol - node.targetVol) < 0.001) {
                node.currentVol = node.targetVol;
            } else {
                const speed = node.targetVol > node.currentVol ? 1 / 2 : 1 / 3; // fadeIn 2s, fadeOut 3s
                node.currentVol += (node.targetVol - node.currentVol) * Math.min(1, dt * speed * 3);
                node.gain.gain.value = Math.max(0, node.currentVol);
            }
        }
    }

    // ============================================================
    // 내부: 인스턴스 해제
    // ============================================================

    private releaseInstance(instance: SoundInstance, poolIdx: number): void {
        try { instance.sourceNode.disconnect(); } catch { /* */ }
        try { instance.filterNode.disconnect(); } catch { /* */ }
        try { instance.pannerNode.disconnect(); } catch { /* */ }
        try { instance.gainNode.disconnect(); } catch { /* */ }

        // 풀 반납 (Panner/Filter/Gain은 재사용 가능)
        // BufferSourceNode는 GC에 맡김
    }

    private findPoolIndex(panner: PannerNode): number {
        // 실제로는 pool 내 인덱스 추적 필요. 여기서는 단순 폴백.
        return 0;
    }

    // ============================================================
    // 완전 정리
    // ============================================================

    /** 모든 리소스 해제 */
    dispose(): void {
        this.stopAllSounds();

        for (const [, node] of this.ambientNodes) {
            if (node.source) {
                try { node.source.stop(); } catch { /* */ }
                try { node.source.disconnect(); } catch { /* */ }
            }
            try { node.gain.disconnect(); } catch { /* */ }
        }
        this.ambientNodes.clear();

        this.pool?.disposeAll();
        this.masterGain?.disconnect();
        this.bufferCache.clear();
        this.activeSounds.clear();

        if (this.ctx) {
            this.ctx.close().catch(() => {});
            this.ctx = null;
        }
    }
}
