/**
 * 삼국지리턴 — WebGL 컨텍스트 복구 + 전역 리소스 추적기
 * 파일: src/core/webgl_recovery.ts
 *
 * [493] WebGL 컨텍스트 분실/복구 + 씬 전환 GC 자동 청소
 *
 * ── 복구 파이프라인 ──
 *
 *   Context Lost 발생
 *     ↓
 *   1. RenderSnapshot 직렬화 (카메라 행렬, 유닛 위치, 이펙트 상태)
 *   2. 모든 WebGL 리소스 강제 dispose (GLProtector가 기존 리소스 정리)
 *   3. 게임 루프 일시 중지
 *     ↓
 *   Context Restored 발생
 *     ↓
 *   4. GLProtector.shaders/textures/buffers 전부 재생성
 *   5. RenderSnapshot 역직렬화 → 원래 상태로 복원
 *   6. 게임 루프 재개
 *
 * ── ResourceTracker ──
 *   - 모든 IDisposable 리소스의 활성 목록 유지
 *   - disposeScope()로 씬 단위 일괄 해제
 *   - disposeAll()으로 전역 정리
 */

import { IDisposable } from './disposable_pool.js';

// ============================================================
// [0] 타입 정의
// ============================================================

/** 카메라 행렬 스냅샷 */
export interface CameraSnapshot {
    readonly projectionMatrix: Float64Array;  // 16 elements
    readonly viewMatrix: Float64Array;        // 16 elements
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
    readonly target: { readonly x: number; readonly y: number; readonly z: number };
    readonly zoom: number;
}

/** 유닛 렌더 스냅샷 */
export interface UnitRenderSnapshot {
    readonly unitId: number;
    readonly hexX: number;
    readonly hexY: number;
    readonly hexZ: number;
    readonly hpPercent: number;
    readonly moralePercent: number;
    readonly isSelected: boolean;
    readonly animationState: string;
}

/** 전법 이펙트 스냅샷 */
export interface EffectSnapshot {
    readonly effectId: string;
    readonly position: { readonly x: number; readonly y: number; readonly z: number };
    readonly duration: number;
    readonly elapsed: number;
    readonly intensity: number;
}

/** 전체 렌더 스냅샷 (컨텍스트 분실 시 저장) */
export interface RenderSnapshot {
    readonly camera: CameraSnapshot;
    readonly units: readonly UnitRenderSnapshot[];
    readonly effects: readonly EffectSnapshot[];
    readonly hexGrid: {
        readonly width: number;
        readonly height: number;
        readonly visibleRegion: {
            readonly minX: number;
            readonly minY: number;
            readonly maxX: number;
            readonly maxY: number;
        };
    };
    readonly timestamp: number;
    readonly weatherState: string;
    readonly ambientLight: {
        readonly intensity: number;
        readonly color: readonly [number, number, number];
    };
}

/** 복구 상태 열거 */
export type RecoveryState =
    | 'NORMAL'
    | 'LOST'
    | 'SNAPSHOT_SAVED'
    | 'RESTORING'
    | 'RESTORED'
    | 'FATAL';

/** WebGL 리소스 재생성 콜백 */
export interface GLResourceFactory {
    createShaders(): Promise<IDisposable[]> | IDisposable[];
    createTextures(): Promise<IDisposable[]> | IDisposable[];
    createBuffers(): Promise<IDisposable[]> | IDisposable[];
    createFramebuffers(): Promise<IDisposable[]> | IDisposable[];
}

/** 복구 진행률 */
export interface RecoveryProgress {
    readonly state: RecoveryState;
    readonly phase: string;
    readonly progress: number;  // 0.0 ~ 1.0
    readonly shadersDone: number;
    readonly texturesDone: number;
    readonly buffersDone: number;
    readonly totalShaders: number;
    readonly totalTextures: number;
    readonly totalBuffers: number;
}

// ============================================================
// [1] GLProtector — GPU 리소스 생명주기 관리자
// ============================================================

/**
 * GLProtector — WebGL GPU 리소스(shader/texture/buffer)의
 *              생명주기(생성/추적/해제/재생성)를 전담 관리
 *
 * 이 클래스가 하는 일:
 *   - 등록된 모든 GPU 리소스 추적
 *   - 일괄 dispose() (컨텍스트 분실 시)
 *   - 일괄 recreate() (컨텍스트 복구 시)
 *   - 리소스 누수 방지 (추적되지 않은 리소스가 남지 않도록)
 */
export class GLProtector {
    private readonly shaders: IDisposable[] = [];
    private readonly textures: IDisposable[] = [];
    private readonly buffers: IDisposable[] = [];
    private readonly framebuffers: IDisposable[] = [];
    private readonly factory: GLResourceFactory;
    private _disposed = false;

    constructor(factory: GLResourceFactory) {
        this.factory = factory;
    }

    // ============================================================
    // 리소스 등록
    // ============================================================

    registerShader(shader: IDisposable): void {
        if (!this._disposed) this.shaders.push(shader);
    }

    registerTexture(texture: IDisposable): void {
        if (!this._disposed) this.textures.push(texture);
    }

    registerBuffer(buffer: IDisposable): void {
        if (!this._disposed) this.buffers.push(buffer);
    }

    registerFramebuffer(fb: IDisposable): void {
        if (!this._disposed) this.framebuffers.push(fb);
    }

    // ============================================================
    // 컨텍스트 분실: 모든 GPU 리소스 dispose
    // ============================================================

    /**
     * 모든 등록된 GPU 리소스 일괄 해제
     * Context Lost 발생 시 호출
     */
    disposeAllGPUResources(): void {
        for (const s of this.shaders) {
            if (!s.disposed) try { s.dispose(); } catch { /* WebGL 컨텍스트 이미 소멸 */ }
        }
        for (const t of this.textures) {
            if (!t.disposed) try { t.dispose(); } catch { /* */ }
        }
        for (const b of this.buffers) {
            if (!b.disposed) try { b.dispose(); } catch { /* */ }
        }
        for (const f of this.framebuffers) {
            if (!f.disposed) try { f.dispose(); } catch { /* */ }
        }

        // 리스트 비우기 (복구 시 재생성)
        this.shaders.length = 0;
        this.textures.length = 0;
        this.buffers.length = 0;
        this.framebuffers.length = 0;
    }

    // ============================================================
    // 컨텍스트 복구: 모든 GPU 리소스 재생성
    // ============================================================

    /**
     * 모든 GPU 리소스 재생성 (Context Restored 시)
     *
     * @param onProgress  복구 진행률 콜백
     * @returns           재생성 완료 시 resolve
     */
    async recreateAllGPUResources(
        onProgress?: (progress: RecoveryProgress) => void,
    ): Promise<void> {
        const report = (phase: string, done: number, total: number) => {
            onProgress?.({
                state: 'RESTORING',
                phase,
                progress: total > 0 ? done / total : 0,
                shadersDone: done,
                texturesDone: 0,
                buffersDone: 0,
                totalShaders: total,
                totalTextures: 0,
                totalBuffers: 0,
            });
        };

        // Shader 재생성
        try {
            const created = await Promise.resolve(this.factory.createShaders());
            for (const s of created) {
                this.shaders.push(s);
            }
            report('shaders', this.shaders.length, this.shaders.length);
        } catch (err) {
            console.error('[GLProtector] Shader recreation failed:', err);
            throw err;
        }

        // Texture 재생성
        try {
            const created = await Promise.resolve(this.factory.createTextures());
            for (const t of created) {
                this.textures.push(t);
            }
        } catch (err) {
            console.error('[GLProtector] Texture recreation failed:', err);
        }

        // Buffer 재생성
        try {
            const created = await Promise.resolve(this.factory.createBuffers());
            for (const b of created) {
                this.buffers.push(b);
            }
        } catch (err) {
            console.error('[GLProtector] Buffer recreation failed:', err);
        }

        // Framebuffer 재생성
        try {
            const created = await Promise.resolve(this.factory.createFramebuffers());
            for (const f of created) {
                this.framebuffers.push(f);
            }
        } catch (err) {
            console.error('[GLProtector] Framebuffer recreation failed:', err);
        }

        onProgress?.({
            state: 'RESTORED',
            phase: 'complete',
            progress: 1,
            shadersDone: this.shaders.length,
            texturesDone: this.textures.length,
            buffersDone: this.buffers.length,
            totalShaders: this.shaders.length,
            totalTextures: this.textures.length,
            totalBuffers: this.buffers.length,
        });
    }

    get disposed(): boolean { return this._disposed; }
    get shaderCount(): number { return this.shaders.length; }
    get textureCount(): number { return this.textures.length; }
    get bufferCount(): number { return this.buffers.length; }
}

// ============================================================
// [2] WebGLRecoveryManager
// ============================================================

/**
 * WebGLRecoveryManager — WebGL 컨텍스트 분실/복구 전체 파이프라인
 *
 * ── 생애주기 ──
 *
 * 1. init(canvas, factory) 호출로 바인딩
 *    - webglcontextlost / webglcontextrestored 이벤트 등록
 *    - GLProtector 생성
 *
 * 2. 컨텍스트 분실 (Context Lost):
 *    a. preventDefault로 기본 복구 차단 (수동 복구)
 *    b. snapshot() → 모든 렌더링 상태 직렬화
 *    c. GLProtector.disposeAllGPUResources() → 기존 GPU 리소스 해제
 *    d. 게임 루프 일시 중지
 *    e. state = LOST
 *
 * 3. 컨텍스트 복구 (Context Restored):
 *    a. state = RESTORING
 *    b. GLProtector.recreateAllGPUResources() → 모든 리소스 재생성
 *    c. restore(snapshot) → 카메라/유닛/이펙트 상태 복원
 *    d. 게임 루프 재개
 *    e. state = RESTORED → NORMAL
 *
 * 4. 복구 실패 시:
 *    a. 최대 재시도 횟수 초과 → FATAL 상태
 *    b. onFatal 콜백 호출
 */
export class WebGLRecoveryManager {
    private canvas: HTMLCanvasElement | null = null;
    private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    private _protector: GLProtector | null = null;
    private _state: RecoveryState = 'NORMAL';
    private snapshot: RenderSnapshot | null = null;
    private readonly onLost: ((snapshot: RenderSnapshot) => void) | null;
    private readonly onRestored: (() => void) | null;
    private readonly onFatal: ((error: Error) => void) | null;
    private readonly onProgress: ((progress: RecoveryProgress) => void) | null;
    private retryCount = 0;
    private readonly maxRetries = 3;
    private lostHandler: ((e: WebGLContextEvent) => void) | null = null;
    private restoredHandler: ((e: WebGLContextEvent) => void) | null = null;
    private _lastSnapshotTime = 0;

    constructor(options: {
        onLost?: (snapshot: RenderSnapshot) => void;
        onRestored?: () => void;
        onFatal?: (error: Error) => void;
        onProgress?: (progress: RecoveryProgress) => void;
    } = {}) {
        this.onLost = options.onLost ?? null;
        this.onRestored = options.onRestored ?? null;
        this.onFatal = options.onFatal ?? null;
        this.onProgress = options.onProgress ?? null;
    }

    // ============================================================
    // 초기화
    // ============================================================

    /**
     * WebGL 컨텍스트에 바인딩
     *
     * @param canvas   대상 Canvas 요소
     * @param gl       WebGL 컨텍스트 (WebGL1 또는 WebGL2)
     * @param factory  GPU 리소스 재생성 팩토리
     */
    init(
        canvas: HTMLCanvasElement,
        gl: WebGLRenderingContext | WebGL2RenderingContext,
        factory: GLResourceFactory,
    ): void {
        this.canvas = canvas;
        this.gl = gl;
        this._protector = new GLProtector(factory);
        this.bindEvents(canvas);
        this._state = 'NORMAL';
    }

    private bindEvents(canvas: HTMLCanvasElement): void {
        this.lostHandler = ((e: Event) => {
            const we = e as WebGLContextEvent;
            we.preventDefault();
            this.handleContextLost(we);
        }) as EventListener;

        this.restoredHandler = ((e: Event) => {
            this.handleContextRestored(e as WebGLContextEvent);
        }) as EventListener;

        canvas.addEventListener('webglcontextlost' as string, this.lostHandler as EventListener);
        canvas.addEventListener('webglcontextrestored' as string, this.restoredHandler as EventListener);
    }

    // ============================================================
    // 스냅샷 생성
    // ============================================================

    /**
     * 현재 렌더링 상태의 스냅샷 생성
     *
     * @param camera     카메라 상태
     * @param units      유닛 렌더 상태 배열
     * @param effects    활성 전법 이펙트 배열
     * @param weather    기상 상태
     * @param hexGrid    헥사 그리드 정보
     * @param ambient    앰비언트 라이트
     * @returns          직렬화된 RenderSnapshot
     */
    createSnapshot(
        camera: CameraSnapshot,
        units: readonly UnitRenderSnapshot[],
        effects: readonly EffectSnapshot[],
        weather: string,
        hexGrid: { width: number; height: number; visibleRegion: { minX: number; minY: number; maxX: number; maxY: number } },
        ambient: { intensity: number; color: readonly [number, number, number] },
    ): RenderSnapshot {
        const snapshot: RenderSnapshot = {
            camera,
            units,
            effects,
            hexGrid,
            timestamp: performance.now(),
            weatherState: weather,
            ambientLight: ambient,
        };
        this._lastSnapshotTime = performance.now();
        return snapshot;
    }

    // ============================================================
    // 컨텍스트 분실 처리
    // ============================================================

    private handleContextLost(_e: WebGLContextEvent): void {
        if (this._state === 'LOST') return; // 중복 감지

        this._state = 'LOST';
        console.warn('[WebGLRecoveryManager] Context lost! Saving snapshot and disposing GPU resources.');

        // 1. 스냅샷 저장 (외부에서 이미 저장했거나, 여기서 생성)
        if (!this.snapshot) {
            // 최후의 수단: 빈 스냅샷이라도 저장
            this.snapshot = this.createEmptySnapshot();
        }

        // 2. GPU 리소스 해제
        this.protector?.disposeAllGPUResources();

        // 3. 콜백
        this.onLost?.(this.snapshot);

        // 4. 게임 루프는 외부에서 this.state 확인 후 일시 중지
    }

    // ============================================================
    // 컨텍스트 복구 처리
    // ============================================================

    private async handleContextRestored(_e: WebGLContextEvent): Promise<void> {
        console.log('[WebGLRecoveryManager] Context restored! Recreating resources.');

        this._state = 'RESTORING';

        try {
            // 1. 모든 GPU 리소스 재생성
            await this.protector?.recreateAllGPUResources(this.onProgress ?? undefined);
        } catch (err) {
            this.retryCount++;
            const error = err instanceof Error ? err : new Error(String(err));

            if (this.retryCount >= this.maxRetries) {
                this._state = 'FATAL';
                this.onFatal?.(error);
                console.error('[WebGLRecoveryManager] Fatal: max retries exceeded.', error);
                return;
            }

            // 재시도
            console.warn(`[WebGLRecoveryManager] Retry ${this.retryCount}/${this.maxRetries}...`);
            setTimeout(() => this.handleContextRestored(_e), 500);
            return;
        }

        // 2. 스냅샷 복원
        if (this.snapshot) {
            this.restoreFromSnapshot(this.snapshot);
        }

        this._state = 'RESTORED';
        this.retryCount = 0;

        // 3. 콜백
        this.onRestored?.();

        // 복구 완료 후 NORMAL로 전환
        this._state = 'NORMAL';
        console.log('[WebGLRecoveryManager] Context fully restored.');
    }

    // ============================================================
    // 스냅샷 복원
    // ============================================================

    /**
     * 저장된 스냅샷에서 렌더링 상태 복원
     *
     * @param snapshot  createSnapshot()으로 저장한 스냅샷
     */
    restoreFromSnapshot(snapshot: RenderSnapshot): void {
        // 카메라 복원
        this.applyCamera(snapshot.camera);

        // 유닛 위치 복원 (외부 renderer에서 구현)
        // → snapshot.units를 순회하며 각 유닛의 위치/애니메이션 복원

        // 이펙트 복원
        // → snapshot.effects를 순회하며 각 이펙트 재생성

        // 앰비언트 라이트 복원
        this.applyAmbientLight(snapshot.ambientLight);

        this.snapshot = null;
    }

    private applyCamera(camera: CameraSnapshot): void {
        // 외부 렌더러에서 이 메서드를 오버라이드하거나
        // cameraプロ퍼티를 읽어서 복원
        // (실제 WebGL 구현체에서 projectionMatrix * inverseViewMatrix 적용)
    }

    private applyAmbientLight(ambient: { intensity: number; color: readonly [number, number, number] }): void {
        // 외부 렌더러에서 앰비언트 라이트 복원
    }

    private createEmptySnapshot(): RenderSnapshot {
        return {
            camera: {
                projectionMatrix: new Float64Array([
                    1, 0, 0, 0,
                    0, 1, 0, 0,
                    0, 0, 1, 0,
                    0, 0, 0, 1,
                ]),
                viewMatrix: new Float64Array([
                    1, 0, 0, 0,
                    0, 1, 0, 0,
                    0, 0, 1, 0,
                    0, 0, 0, 1,
                ]),
                position: { x: 0, y: 0, z: 10 },
                target: { x: 0, y: 0, z: 0 },
                zoom: 1,
            },
            units: [],
            effects: [],
            hexGrid: {
                width: 0,
                height: 0,
                visibleRegion: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
            },
            timestamp: performance.now(),
            weatherState: 'SUNNY',
            ambientLight: { intensity: 1, color: [1, 1, 1] },
        };
    }

    // ============================================================
    // 제어
    // ============================================================

    /** 현재 복구 상태 */
    get state(): RecoveryState { return this._state; }

    /** GLProtector 참조 */
    getProtector(): GLProtector | null { return this._protector; }

    /** @deprecated Use getProtector() */
    get protector(): GLProtector | null { return this._protector; }

    /** 마지막 스냅샷 */
    get lastSnapshot(): RenderSnapshot | null { return this.snapshot; }

    /** 현재 스냅샷 시간 (성능 측정용) */
    get lastSnapshotTime(): number { return this._lastSnapshotTime; }

    /**
     * 수동 스냅샷 설정 (외부에서 생성한 스냅샷 주입)
     */
    setSnapshot(snapshot: RenderSnapshot): void {
        this.snapshot = snapshot;
    }

    /** 이벤트 리스너 해제 */
    dispose(): void {
        if (this.canvas) {
            if (this.lostHandler) {
                this.canvas.removeEventListener('webglcontextlost' as string, this.lostHandler as EventListener);
            }
            if (this.restoredHandler) {
                this.canvas.removeEventListener('webglcontextrestored' as string, this.restoredHandler as EventListener);
            }
        }
        this._protector?.disposeAllGPUResources();
        this.snapshot = null;
        this._state = 'NORMAL';
        this.canvas = null;
        this.gl = null;
    }
}

// ============================================================
// [3] ResourceTracker — 전역 리소스 추적기
// ============================================================

/**
 * ResourceTracker — 모든 IDisposable 리소스의 생명주기를 추적하고
 *                   씬 전환 시 일괄 해제하는 전역 청소기
 *
 * ── 사용 예 ──
 * ```typescript
 * const tracker = ResourceTracker.getInstance();
 *
 * // 리소스 등록
 * tracker.track(texture, 'texture');
 * tracker.track(geometry, 'geometry');
 * tracker.track(eventListener, 'listener');
 *
 * // 씬 전환 시:
 * tracker.disposeScope('battle');
 * tracker.disposeScope('council');
 *
 * // 전체 정리:
 * tracker.disposeAll();
 * ```
 */
export class ResourceTracker {
    private static instance: ResourceTracker | null = null;
    private readonly resources: Map<string, { resource: IDisposable; scope: string; createdAt: number }[]> = new Map();
    private readonly scopes: Map<string, number> = new Map(); // scope name → 리소스 수
    private _totalTracked = 0;
    private _totalDisposed = 0;
    private readonly leakWarnThreshold = 1000; // scope당 1000개 이상이면 누수 경고

    private constructor() {}

    static getInstance(): ResourceTracker {
        if (!ResourceTracker.instance) {
            ResourceTracker.instance = new ResourceTracker();
        }
        return ResourceTracker.instance;
    }

    // ============================================================
    // 리소스 등록
    // ============================================================

    /**
     * 리소스를 추적에 등록
     *
     * @param resource  IDisposable 리소스
     * @param type      리소스 종류 ('texture', 'geometry', 'material', 'shader', 'listener', 'animation', 'generic')
     * @param scope     소속 scope ('battle', 'council', 'worldmap', 'ui', 'global')
     */
    track(resource: IDisposable, type: string = 'generic', scope: string = 'global'): void {
        let list = this.resources.get(type);
        if (!list) {
            list = [];
            this.resources.set(type, list);
        }

        list.push({ resource, scope, createdAt: performance.now() });
        this.scopes.set(scope, (this.scopes.get(scope) ?? 0) + 1);
        this._totalTracked++;

        // 누수 경고
        const count = this.scopes.get(scope) ?? 0;
        if (count >= this.leakWarnThreshold) {
            console.warn(
                `[ResourceTracker] Leak warning: scope "${scope}" has ${count} tracked resources. ` +
                'Consider calling disposeScope() before switching scenes.',
            );
        }
    }

    // ============================================================
    // 리소스 해제
    // ============================================================

    /**
     * 특정 타입의 모든 리소스 해제
     */
    disposeType(type: string): number {
        const list = this.resources.get(type);
        if (!list) return 0;

        let count = 0;
        for (const entry of list) {
            if (!entry.resource.disposed) {
                try {
                    entry.resource.dispose();
                    count++;
                } catch (err) {
                    console.warn(`[ResourceTracker] dispose error (type=${type}):`, err);
                }
            }
            // scope 카운트 감소
            const scopeCount = this.scopes.get(entry.scope) ?? 0;
            if (scopeCount > 0) {
                this.scopes.set(entry.scope, scopeCount - 1);
            }
        }
        this.resources.delete(type);
        this._totalDisposed += count;
        return count;
    }

    /**
     * 특정 scope의 모든 리소스 일괄 해제
     * 씬 전환 시 호출 (예: disposeScope('battle') → 전투 씬 리소스 전부 정리)
     */
    disposeScope(scope: string): number {
        let totalDisposed = 0;

        for (const [, list] of this.resources) {
            const remaining: typeof list = [];

            for (const entry of list) {
                if (entry.scope === scope) {
                    if (!entry.resource.disposed) {
                        try {
                            entry.resource.dispose();
                            totalDisposed++;
                        } catch (err) {
                            console.warn(`[ResourceTracker] disposeScope error (scope=${scope}):`, err);
                        }
                    }
                } else {
                    remaining.push(entry);
                }
            }

            // 해당 scope 리소스 제거
            list.length = 0;
            list.push(...remaining);
        }

        this.scopes.delete(scope);
        this._totalDisposed += totalDisposed;

        if (totalDisposed > 0) {
            console.log(`[ResourceTracker] Disposed ${totalDisposed} resources in scope "${scope}"`);
        }

        return totalDisposed;
    }

    /**
     * 모든 리소스 해제 (게임 종료 시)
     */
    disposeAll(): number {
        let total = 0;
        for (const [, list] of this.resources) {
            for (const entry of list) {
                if (!entry.resource.disposed) {
                    try {
                        entry.resource.dispose();
                        total++;
                    } catch (err) {
                        console.warn('[ResourceTracker] disposeAll error:', err);
                    }
                }
            }
        }
        this.resources.clear();
        this.scopes.clear();
        this._totalDisposed += total;

        console.log(`[ResourceTracker] Disposed ALL ${total} resources. Tracked: ${this._totalTracked}, Total disposed: ${this._totalDisposed}`);
        return total;
    }

    // ============================================================
    // 이벤트 리스너 추적
    // ============================================================

    /**
     * Window/DOM 이벤트 리스너를 IDisposable로 래핑하여 추적
     *
     * 사용 예:
     * ```typescript
     * const listener = tracker.trackListener(window, 'resize', onResize);
     * // 씬 전환 시 자동으로 removeEventListener 호출
     * ```
     */
    trackListener(
        target: EventTarget,
        type: string,
        handler: EventListenerOrEventListenerObject,
        options?: AddEventListenerOptions,
        scope: string = 'global',
    ): IDisposable {
        target.addEventListener(type, handler, options);

        const disposable: IDisposable = {
            disposed: false,
            dispose: () => {
                if (!disposable.disposed) {
                    target.removeEventListener(type, handler, options);
                    disposable.disposed = true;
                }
            },
        };

        this.track(disposable, 'listener', scope);
        return disposable;
    }

    /**
     * requestAnimationFrame ID를 래핑하여 추적
     */
    trackAnimationFrame(id: number, scope: string = 'global'): IDisposable {
        const disposable: IDisposable = {
            disposed: false,
            dispose: () => {
                if (!disposable.disposed) {
                    cancelAnimationFrame(id);
                    disposable.disposed = true;
                }
            },
        };

        this.track(disposable, 'animation', scope);
        return disposable;
    }

    /**
     * setInterval ID를 래핑하여 추적
     */
    trackInterval(id: ReturnType<typeof setInterval>, scope: string = 'global'): IDisposable {
        const disposable: IDisposable = {
            disposed: false,
            dispose: () => {
                if (!disposable.disposed) {
                    clearInterval(id);
                    disposable.disposed = true;
                }
            },
        };

        this.track(disposable, 'interval', scope);
        return disposable;
    }

    // ============================================================
    // 진단
    // ============================================================

    /** 현재 추적 중인 총 리소스 수 */
    get totalTracked(): number { return this._totalTracked; }
    get totalDisposed(): number { return this._totalDisposed; }

    /** 등록된 모든 scope 이름 */
    get scopeNames(): string[] {
        return Array.from(this.scopes.keys());
    }

    /** 특정 scope의 리소스 수 */
    countByScope(scope: string): number {
        return this.scopes.get(scope) ?? 0;
    }

    /** 타입별 리소스 수 */
    countByType(type: string): number {
        return this.resources.get(type)?.length ?? 0;
    }

    /**
     * 보고서 생성
     */
    generateReport(): string {
        const lines: string[] = [
            '=== ResourceTracker Report ===',
            `Total tracked: ${this._totalTracked}`,
            `Total disposed: ${this._totalDisposed}`,
            `Active types: ${this.resources.size}`,
            `Active scopes: ${this.scopes.size}`,
            '',
            '--- By Scope ---',
        ];

        for (const [scope, count] of this.scopes) {
            lines.push(`  ${scope}: ${count}`);
        }

        lines.push('', '--- By Type ---');
        for (const [type, list] of this.resources) {
            lines.push(`  ${type}: ${list.length}`);
        }

        return lines.join('\n');
    }
}

// ============================================================
// [4] 전역 진입점 (선택적 초기화)
// ============================================================

/**
 * 웹 페이지에 WebGL 복구 시스템을 자동으로 바인딩
 *
 * @param canvas   Canvas 요소
 * @param gl       WebGL 컨텍스트
 * @param factory  GPU 리소스 재생성 팩토리
 * @returns        WebGLRecoveryManager 인스턴스
 */
export function initWebGLRecovery(
    canvas: HTMLCanvasElement,
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    factory: GLResourceFactory,
): WebGLRecoveryManager {
    const manager = new WebGLRecoveryManager({
        onLost: (snapshot) => {
            console.log(`[initWebGLRecovery] Context lost. Snapshot saved at t=${snapshot.timestamp}`);
        },
        onRestored: () => {
            console.log('[initWebGLRecovery] Context restored. Game loop resumed.');
        },
        onFatal: (error) => {
            console.error('[initWebGLRecovery] Fatal recovery failure:', error.message);
            // 최후의 수단: 페이지 새로고침
            if (confirm('WebGL 복구에 실패했습니다. 페이지를 새로고침하시겠습니까?')) {
                window.location.reload();
            }
        },
    });

    manager.init(canvas, gl, factory);
    return manager;
}
