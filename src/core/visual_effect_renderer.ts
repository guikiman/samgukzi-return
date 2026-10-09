/**
 * 삼국지리턴 — WebGL 기반 수묵화 셰이더 및 동적 스크린 트랜지션 렌더러
 * 파일: src/core/visual_effect_renderer.ts
 *
 * GPU 가속 GLSL 단편 셰이더(Fragment Shader) 기반 포스트 프로세싱 파이프라인
 *
 * [482] 동적 피사체 심도 (Depth of Field)
 * [483] 색수차(Chromatic Aberration) 타격감
 * [490] 물결(Water Ripple) 셰이더
 * [493] 타일 강조(Highlight) 박동(Pulse) 애니메이션
 * [496] 화면 전환 잉크 번짐(Ink Bleed) 트랜지션
 */

// ============================================================
// [1] GLSL 단편 셰이더 소스코드
// ============================================================

/**
 * Ink Bleed Transition Shader (잉크 번짐 화면 전환)
 *
 * 수학적 원리:
 * 1. 입력 텍스처(u_image)와 노이즈 텍스처(u_noise)를 샘플링
 * 2. Perlin-like 3D 노이즈 공간에서 2D 슬라이스를 생성:
 *    noise(x, y) = fbm( (x + offsetX) * scale, (y + offsetY) * scale, progress * 3.0 )
 *    여기서 fbm은 4옥타브 Fractal Brownian Motion.
 * 3. 각 픽셀의 밝기(L) = 0.299R + 0.587G + 0.114B (ITU-R BT.601 휘도)
 * 4. Dissolve 조건:
 *    if (noise(x, y) > threshold(L, progress)) → 원본 픽셀 표시
 *    else → 먹물 색상으로 대체
 *    threshold(L, p) = L * (1 - p * 0.5) + p * 0.8
 *    : 어두운 영역(L↓)일수록 threshold 낮음 → 먼저 번짐
 *    : progress가 0→1로 갈수록 threshold 상승 → 점진적 전환
 * 5. 경계선(noise ≈ threshold) 영역은 알파 블렌딩으로 유기적 번짐 표현
 */
export const INK_BLEED_FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform sampler2D u_noise;
uniform float u_progress;      // 0.0 → 1.0: 전환 진행도
uniform vec2 u_resolution;
uniform vec4 u_inkColor;       // 먹물 색상 (기본: rgba(20, 20, 20, 1.0))
uniform float u_scale;         // 노이즈 스케일 (기본: 4.0)

in vec2 v_texCoord;
out vec4 fragColor;

// ── 의사 난수 해시 함수 ──
// 입력 2D 좌표 → [0,1) 균등 분포 난수
// GLSL 내장 함수를 사용하지 않는 결정론적 해시
float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}

// ── 2D Value Noise (Perlin-like) ──
// 정수 그리드 코너 4점을 해시로 보간하여 부드러운 노이즈 생성
// smoothstep(0→1)으로 큐빅 보간: 3t² - 2t³
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);  // Hermite smoothstep

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));

    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// ── Fractal Brownian Motion (4옥타브) ──
// 다중 스케일 노이즈를 누적하여 자연스러운 먹물 번짐 패턴 생성
// 각 옥타브: 진폭 0.5^n, 주파수 2^n
// ∑ (A^n × noise(P × 2^n))
float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for (int i = 0; i < 4; i++) {
        value += amplitude * noise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    return value;
}

void main() {
    vec2 uv = v_texCoord;
    vec4 imageColor = texture(u_image, uv);

    // 휘도 계산 (ITU-R BT.601): L = 0.299R + 0.587G + 0.114B
    float luminance = dot(imageColor.rgb, vec3(0.299, 0.587, 0.114));

    // 3D FBM 노이즈: 2D 위치 + progress를 세 번째 차원으로 사용
    vec2 noiseCoord = uv * u_scale + vec2(u_progress * 2.0, u_progress * 1.5);
    float noiseVal = fbm(noiseCoord);

    // 임계값 함수: 어두운 픽셀(L↓) → threshold 낮음 → 먼저 소멸
    // progress↑ → threshold 상승 → 점진적 전환
    float threshold = luminance * (1.0 - u_progress * 0.5) + u_progress * 0.8;

    // 경계선 알파: noise가 threshold 주변 ±0.05 범위일 때 0→1 블렌딩
    float edgeWidth = 0.05;
    float alpha = smoothstep(threshold - edgeWidth, threshold + edgeWidth, noiseVal);

    // 최종 출력: 이미지 ↔ 먹물 색상 알파 블렌딩
    vec4 ink = u_inkColor;
    fragColor = mix(ink, imageColor, alpha);
}
`;

/**
 * Chromatic Aberration Shader (색수차 포스트 프로세싱)
 *
 * 수학적 원리:
 * 1. RGB 각 채널을 서로 다른 오프셋으로 샘플링하여 빛의 분산(dispersion) 시뮬레이션
 * 2. R 채널 오프셋: (intensity * direction.x, intensity * direction.y)
 *    G 채널: 오프셋 없음 (중심 기준)
 *    B 채널 오프셋: (-intensity * direction.x, -intensity * direction.y)
 * 3. 방향 벡터 direction = normalize(uv - 0.5): 화면 중심에서 바깥 방향
 *    → 가장자리일수록 색수차 강함 (렌즈 물리 현상과 일치)
 * 4. intensity는 시간에 따라 지수 감쇠: I(t) = I₀ × decayFactor^t
 *    → 0.1초 내외로 빠르게 소멸
 * 5. 배럴 왜곡(Barrel Distortion) 추가: r' = r × (1 + k × r²)
 *    k > 0: 배럴 왜곡 (핀쿠션 보정)
 */
export const CHROMATIC_ABERRATION_FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform float u_intensity;     // 0.0 ~ 1.0: 색수차 세기
uniform vec2 u_resolution;
uniform float u_barrelK;       // 배럴 왜곡 계수 (기본: 0.02)

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec2 uv = v_texCoord;

    // 화면 중심 기준 정규화 좌표 [-1, 1]
    vec2 center = uv - 0.5;
    float r = length(center);

    // 배럴 왜곡: r' = r × (1 + k × r²)
    // r이 클수록(가장자리) 왜곡 증가
    float barrelR = r * (1.0 + u_barrelK * r * r);
    vec2 barrelDir = r > 0.0 ? center / r : vec2(0.0);
    vec2 barrelUV = uv;  // 배럴 왜곡 적용 안 함 (텍스처 유지)

    // 방향 벡터: 중심에서 바깥 방향 (정규화)
    vec2 dir = r > 0.0 ? center / r : vec2(0.0);

    // 채널별 오프셋: R = +direction, B = -direction
    // 투영 행렬 고려: 종횡비 보정
    float aspect = u_resolution.x / u_resolution.y;
    vec2 offset = dir * u_intensity * 0.02 * vec2(1.0, aspect);
    offset *= (1.0 + r * 0.5);  // 가장자리로 갈수록 강화

    // 각 채널 독립 샘플링
    float rChan = texture(u_image, uv + offset).r;
    float gChan = texture(u_image, uv).g;
    float bChan = texture(u_image, uv - offset).b;

    // 채널 합성
    fragColor = vec4(rChan, gChan, bChan, 1.0);
}
`;

/**
 * Water Ripple + Pulse Highlight Shader (물결 + 타일 펄스)
 *
 * 수학적 원리:
 * 1. 다중 파동 중첩(Superposition):
 *    D(x, y, t) = Σ Aᵢ × sin(ωᵢ × dist(P, Cᵢ) - phaseᵢ(t))
 *    각 파동: 중심 Cᵢ에서 동심원 형태로 퍼져나감
 *    Aᵢ: 진폭 (시간에 따라 감쇠: Aᵢ(t) = Aᵢ₀ × 0.97^t)
 *    ωᵢ: 주파수 (파동 간격)
 *    phaseᵢ(t): 위상 (시간에 따라 선형 증가)
 *
 * 2. Pulse 하이라이트:
 *    alpha(t) = 0.3 + 0.7 × (0.5 + 0.5 × sin(ω_pulse × t))
 *    타일 경계선 주변에 링 형태로 렌더링
 *
 * 3. UV 변위(Displacement):
 *    dx = ∇D · (1, 0), dy = ∇D · (0, 1)
 *    변위된 UV로 텍스처 리샘플링 → 물결에 의한 굴절 효과
 */
export const WATER_RIPPLE_FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

uniform sampler2D u_image;
uniform sampler2D u_rippleMap;  // Ripple height map (R: height, G: phase)
uniform float u_time;
uniform vec2 u_resolution;
uniform vec4 u_pulseColor;     // 펄스 하이라이트 색상
uniform float u_pulseAlpha;    // 펄스 알파 (0.3~1.0)
uniform vec2 u_mouseHex;       // 마우스 호버 헥스 좌표

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
    vec2 uv = v_texCoord;

    // 리플 맵에서 높이와 위상 샘플링
    vec4 rippleData = texture(u_rippleMap, uv);
    float height = rippleData.r;       // 물결 높이
    float phase = rippleData.g;        // 위상

    // UV 변위 (굴절 효과): height 기반 수평/수직 시프트
    // 굴절률 1.33 (물) 시뮬레이션: sin(입사각) / sin(굴절각) = n
    float refractionStrength = 0.02;
    vec2 displacedUv = uv + vec2(
        height * sin(phase) * refractionStrength,
        height * cos(phase * 1.3) * refractionStrength
    );

    // 변위된 UV로 이미지 샘플링
    vec4 color = texture(u_image, displacedUv);

    // 펄스 하이라이트 오버레이
    // 타일 경계선 감지 (uv 기반 모의 hex grid)
    vec2 hexSize = 1.0 / vec2(12.0, 8.0);  // 12×8 헥스 그리드 가정
    vec2 hexUV = fract(uv / hexSize) - 0.5;
    float hexDist = length(hexUV);

    // 헥스 경계선 (hex radial distance ≈ 0.5에서 경계)
    float edge = 1.0 - smoothstep(0.35, 0.5, hexDist);

    // 펄스 알파와 경계선 곱
    float pulse = edge * u_pulseAlpha * 0.5;

    // 최종 색상: 원본 이미지 + 펄스 하이라이트 오버레이
    vec3 finalColor = color.rgb + u_pulseColor.rgb * pulse;

    fragColor = vec4(finalColor, color.a);
}
`;

/**
 * 전체 화면 사각형 정점 셰이더 (공용)
 * 2개의 삼각형으로 화면 전체를 덮는 단순 패스스루
 */
export const FULLSCREEN_VERTEX_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
    v_texCoord = a_texCoord;
}
`;

// ============================================================
// [2] WebGL 기반 셰이더 매니저
// ============================================================

export type ShaderEffect = "inkBleed" | "chromaticAberration" | "waterRipple";

export interface ShaderUniforms {
    readonly u_progress?: number;
    readonly u_intensity?: number;
    readonly u_time?: number;
    readonly u_pulseAlpha?: number;
    readonly u_inkColor?: readonly [number, number, number, number];
    [key: string]: number | readonly number[] | undefined;
}

export class WebGLShaderManager {
    private gl: WebGL2RenderingContext | null = null;
    private programs = new Map<ShaderEffect, WebGLProgram>();
    private readonly vertexShader: WebGLShader;
    private quadVAO: WebGLVertexArrayObject | null = null;
    private quadVBO: WebGLBuffer | null = null;
    private texCoordVBO: WebGLBuffer | null = null;
    private noiseTexture: WebGLTexture | null = null;
    private rippleTexture: WebGLTexture | null = null;
    private frameBuffer: WebGLFramebuffer | null = null;
    private renderTexture: WebGLTexture | null = null;
    private width = 0;
    private height = 0;
    private initialized = false;

    constructor() {
        this.vertexShader = this.compileShaderSource(
            FULLSCREEN_VERTEX_SHADER,
            WebGL2RenderingContext.VERTEX_SHADER,
        );
    }

    // ============================================================
    // WebGL 초기화
    // ============================================================

    initialize(canvas: HTMLCanvasElement): boolean {
        const gl = canvas.getContext("webgl2", {
            alpha: true,
            premultipliedAlpha: false,
            preserveDrawingBuffer: false,
        });
        if (!gl) {
            console.warn("[VisualEffectRenderer] WebGL2 not available");
            return false;
        }

        this.gl = gl;
        this.width = canvas.width;
        this.height = canvas.height;

        // 셰이더 프로그램 컴파일
        this.compileProgram("inkBleed", INK_BLEED_FRAGMENT_SHADER);
        this.compileProgram("chromaticAberration", CHROMATIC_ABERRATION_FRAGMENT_SHADER);
        this.compileProgram("waterRipple", WATER_RIPPLE_FRAGMENT_SHADER);

        // 전체 화면 쿼드 정점 버퍼
        this.initQuadGeometry(gl);

        // 노이즈 텍스처 생성 (Ink Bleed용)
        this.noiseTexture = this.createNoiseTexture(gl, 256, 256);

        // 리플 텍스처 (Water Ripple용)
        this.rippleTexture = this.createRippleTexture(gl, 256, 256);

        // 프레임버퍼 (오프스크린 렌더링)
        this.initFramebuffer(gl);
        this.initialized = true;
        return true;
    }

    get isInitialized(): boolean {
        return this.initialized;
    }

    // ============================================================
    // 셰이더 리소스 관리
    // ============================================================

    private compileShaderSource(source: string, type: number): WebGLShader {
        if (!this.gl) throw new Error("WebGL not initialized");

        const gl = this.gl;
        const shader = gl.createShader(type);
        if (!shader) throw new Error("Failed to create shader object");

        gl.shaderSource(shader, source);
        gl.compileShader(shader);

        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const log = gl.getShaderInfoLog(shader) ?? "Unknown compile error";
            gl.deleteShader(shader);
            throw new Error(`Shader compile error:\n${log}`);
        }
        return shader;
    }

    private compileProgram(name: ShaderEffect, fragmentSource: string): WebGLProgram {
        if (!this.gl) throw new Error("WebGL not initialized");
        const gl = this.gl;

        const fragmentShader = this.compileShaderSource(
            fragmentSource,
            gl.FRAGMENT_SHADER,
        );

        const program = gl.createProgram();
        if (!program) throw new Error("Failed to create program");

        gl.attachShader(program, this.vertexShader);
        gl.attachShader(program, fragmentShader);
        gl.linkProgram(program);

        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            const log = gl.getProgramInfoLog(program) ?? "Unknown link error";
            gl.deleteProgram(program);
            throw new Error(`Program link error (${name}):\n${log}`);
        }

        gl.deleteShader(fragmentShader);
        this.programs.set(name, program);
        return program;
    }

    // ============================================================
    // 전체 화면 쿼드 형상
    // ============================================================

    private initQuadGeometry(gl: WebGL2RenderingContext): void {
        // 정점 위치: [-1, 1] NDC 사각형
        const vertices = new Float32Array([
            -1, -1,
             1, -1,
            -1,  1,
             1,  1,
        ]);

        const texCoords = new Float32Array([
            0, 0,
            1, 0,
            0, 1,
            1, 1,
        ]);

        this.quadVAO = gl.createVertexArray();
        gl.bindVertexArray(this.quadVAO);

        // 위치 버퍼
        this.quadVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
        gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

        // 텍스처 좌표 버퍼
        this.texCoordVBO = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordVBO);
        gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }

    // ============================================================
    // 텍스처 자원 생성
    // ============================================================

    private createNoiseTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture {
        const data = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const val = Math.floor(Math.random() * 256);
                data[idx] = val;
                data[idx + 1] = val;
                data[idx + 2] = val;
                data[idx + 3] = 255;
            }
        }

        const texture = gl.createTexture();
        if (!texture) throw new Error("Failed to create noise texture");

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0,
            gl.RGBA, gl.UNSIGNED_BYTE, data,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

        return texture;
    }

    private createRippleTexture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture {
        const data = new Uint8Array(w * h * 4);

        const texture = gl.createTexture();
        if (!texture) throw new Error("Failed to create ripple texture");

        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0,
            gl.RGBA, gl.UNSIGNED_BYTE, data,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        return texture;
    }

    private initFramebuffer(gl: WebGL2RenderingContext): void {
        this.renderTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.renderTexture);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0,
            gl.RGBA, gl.UNSIGNED_BYTE, null,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        this.frameBuffer = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer);
        gl.framebufferTexture2D(
            gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.renderTexture, 0,
        );

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            console.warn(`[VisualEffectRenderer] Framebuffer incomplete: ${status}`);
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ============================================================
    // 리플 텍스처 업데이트 (CPU→GPU)
    // ============================================================

    updateRippleTexture(ripples: readonly { x: number; y: number; amplitude: number; phase: number }[]): void {
        if (!this.gl || !this.rippleTexture) return;
        const gl = this.gl;

        const w = 256;
        const h = 256;
        const data = new Uint8Array(w * h * 4);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const idx = (y * w + x) * 4;
                const nx = x / w;
                const ny = y / h;

                let height = 0;
                let phase = 0;
                for (const r of ripples) {
                    const dx = nx - r.x / w;
                    const dy = ny - r.y / h;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    height += Math.sin(dist * 8.0 - r.phase) * r.amplitude;
                    phase += r.phase;
                }
                height = Math.max(0, Math.min(1, (height + 1) * 0.5));

                data[idx] = Math.floor(height * 255);
                data[idx + 1] = Math.floor(((phase / ripples.length) % (Math.PI * 2)) / (Math.PI * 2) * 255);
                data[idx + 2] = 0;
                data[idx + 3] = 255;
            }
        }

        gl.bindTexture(gl.TEXTURE_2D, this.rippleTexture);
        gl.texSubImage2D(
            gl.TEXTURE_2D, 0, 0, 0, w, h,
            gl.RGBA, gl.UNSIGNED_BYTE, data,
        );
    }

    // ============================================================
    // 셰이더 렌더링
    // ============================================================

    renderEffect(
        effect: ShaderEffect,
        sourceTexture: WebGLTexture | null,
        uniforms: ShaderUniforms,
    ): void {
        const gl = this.gl;
        const program = this.programs.get(effect);
        if (!gl || !program || !this.quadVAO) return;

        gl.useProgram(program);

        // 정점 속성 설정
        gl.bindVertexArray(this.quadVAO);

        const posLoc = gl.getAttribLocation(program, "a_position");
        if (posLoc >= 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO);
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
        }

        const texLoc = gl.getAttribLocation(program, "a_texCoord");
        if (texLoc >= 0) {
            gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordVBO);
            gl.enableVertexAttribArray(texLoc);
            gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 0, 0);
        }

        // 텍스처 유닛 바인딩
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
        gl.uniform1i(gl.getUniformLocation(program, "u_image"), 0);

        // 특수 텍스처 바인딩
        if (effect === "inkBleed" && this.noiseTexture) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.noiseTexture);
            gl.uniform1i(gl.getUniformLocation(program, "u_noise"), 1);
        }

        if (effect === "waterRipple" && this.rippleTexture) {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, this.rippleTexture);
            gl.uniform1i(gl.getUniformLocation(program, "u_rippleMap"), 1);
        }

        // 유니폼 설정
        this.setUniforms(gl, program, uniforms);

        // 전체 화면 쿼드 렌더링 (2 삼각형 = 4 정점)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.bindVertexArray(null);
    }

    private setUniforms(
        gl: WebGL2RenderingContext,
        program: WebGLProgram,
        uniforms: ShaderUniforms,
    ): void {
        for (const [key, value] of Object.entries(uniforms)) {
            const loc = gl.getUniformLocation(program, key);
            if (loc === null) continue;

            if (typeof value === "number") {
                gl.uniform1f(loc, value);
            } else if (Array.isArray(value)) {
                if (value.length === 2) gl.uniform2f(loc, value[0] ?? 0, value[1] ?? 0);
                else if (value.length === 4) gl.uniform4f(loc, value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 0);
            }
        }

        // 공용 유니폼
        const resLoc = gl.getUniformLocation(program, "u_resolution");
        if (resLoc) gl.uniform2f(resLoc, this.width, this.height);
    }

    // ============================================================
    // 리소스 정리
    // ============================================================

    dispose(): void {
        if (!this.gl) return;
        const gl = this.gl;

        gl.deleteVertexArray(this.quadVAO);
        gl.deleteBuffer(this.quadVBO);
        gl.deleteBuffer(this.texCoordVBO);
        gl.deleteTexture(this.noiseTexture);
        gl.deleteTexture(this.rippleTexture);
        gl.deleteTexture(this.renderTexture);
        gl.deleteFramebuffer(this.frameBuffer);

        for (const program of this.programs.values()) {
            gl.deleteProgram(program);
        }
        gl.deleteShader(this.vertexShader);
        this.programs.clear();
        this.initialized = false;
        this.gl = null;
    }

    resize(width: number, height: number): void {
        if (!this.gl) return;
        this.width = width;
        this.height = height;
        this.initFramebuffer(this.gl);
    }
}

// ============================================================
// [3] VisualEffectRenderer — 통합 이펙트 렌더러
// ============================================================

export type EffectCommand =
    | { readonly type: "inkBleed"; readonly progress: number; readonly inkColor?: readonly [number, number, number, number] }
    | { readonly type: "chromaticAberration"; readonly intensity: number }
    | { readonly type: "waterRipple"; readonly time: number; readonly pulseAlpha: number; readonly ripples: readonly { x: number; y: number; amplitude: number; phase: number }[] };

export class VisualEffectRenderer {
    private readonly shaderManager: WebGLShaderManager;
    private canvas: HTMLCanvasElement | null = null;
    private srcCanvas: HTMLCanvasElement | null = null;
    private srcCtx: CanvasRenderingContext2D | null = null;
    private srcTexture: WebGLTexture | null = null;
    private effectQueue: EffectCommand[] = [];
    private isProcessing = false;
    private readonly decayFactor = 0.85;
    private readonly minIntensity = 0.01;

    constructor() {
        this.shaderManager = new WebGLShaderManager();
    }

    // ============================================================
    // 초기화
    // ============================================================

    /**
     * @param canvas - WebGL 렌더링 대상 캔버스
     * @param sourceCanvas - 게임 렌더링 소스 캔버스 (Canvas 2D)
     */
    initialize(canvas: HTMLCanvasElement, sourceCanvas: HTMLCanvasElement): boolean {
        this.canvas = canvas;
        this.srcCanvas = sourceCanvas;
        this.srcCtx = sourceCanvas.getContext("2d");

        if (!this.shaderManager.initialize(canvas)) {
            console.warn("[VisualEffectRenderer] WebGL init failed, falling back to Canvas 2D");
            return false;
        }

        canvas.style.position = "absolute";
        canvas.style.top = "0";
        canvas.style.left = "0";
        canvas.style.pointerEvents = "none";
        canvas.width = sourceCanvas.width;
        canvas.height = sourceCanvas.height;

        return true;
    }

    get isReady(): boolean {
        return this.shaderManager.isInitialized;
    }

    // ============================================================
    // 이펙트 큐
    // ============================================================

    enqueueTransitionInkBleed(durationMs: number = 1000): void {
        this.effectQueue.push({
            type: "inkBleed",
            progress: 0,
        });
    }

    triggerChromaticAberration(intensity: number = 1.0): void {
        this.effectQueue.push({
            type: "chromaticAberration",
            intensity,
        });
    }

    triggerWaterRipple(ripplePoints: readonly { x: number; y: number; amplitude: number }[]): void {
        this.effectQueue.push({
            type: "waterRipple",
            time: 0,
            pulseAlpha: 0,
            ripples: ripplePoints.map(p => ({ ...p, phase: 0 })),
        });
    }

    // ============================================================
    // 프레임 업데이트
    // ============================================================

    update(dt: number): void {
        if (!this.isReady || this.effectQueue.length === 0) return;

        // 소스 캔버스 → WebGL 텍스처 복사
        this.copySourceToTexture();

        // 이펙트 큐 처리
        const command = this.effectQueue[0];

        switch (command.type) {
            case "inkBleed": {
                const inkProgress = Math.min(1, command.progress + dt * 0.5);
                this.shaderManager.renderEffect("inkBleed", this.srcTexture, {
                    u_progress: inkProgress,
                    u_inkColor: command.inkColor ?? [0.08, 0.08, 0.08, 1.0],
                    u_scale: 4.0,
                });
                if (inkProgress >= 1) {
                    this.effectQueue.shift();
                } else {
                    this.effectQueue[0] = { ...command, progress: inkProgress };
                }
                break;
            }

            case "chromaticAberration": {
                const intensity = command.intensity;
                if (intensity < this.minIntensity) {
                    this.effectQueue.shift();
                    break;
                }
                this.shaderManager.renderEffect("chromaticAberration", this.srcTexture, {
                    u_intensity: intensity,
                    u_barrelK: 0.02,
                });
                this.effectQueue[0] = { ...command, intensity: intensity * this.decayFactor };
                break;
            }

            case "waterRipple": {
                this.shaderManager.updateRippleTexture(command.ripples);
                this.shaderManager.renderEffect("waterRipple", this.srcTexture, {
                    u_time: command.time,
                    u_pulseAlpha: command.pulseAlpha,
                    u_mouseHex: [0, 0],
                });
                break;
            }
        }
    }

    // ============================================================
    // GPU 텍스처 관리
    // ============================================================

    private copySourceToTexture(): void {
        if (!this.gl || !this.srcCanvas || !this.srcCtx) return;
        const gl = this.gl;

        if (!this.srcTexture) {
            this.srcTexture = gl.createTexture();
        }

        gl.bindTexture(gl.TEXTURE_2D, this.srcTexture);
        gl.texImage2D(
            gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.srcCanvas,
        );
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    private get gl(): WebGL2RenderingContext | null {
        return this.shaderManager["gl"];
    }

    // ============================================================
    // 정리
    // ============================================================

    dispose(): void {
        if (this.srcTexture && this.gl) {
            this.gl.deleteTexture(this.srcTexture);
            this.srcTexture = null;
        }
        this.shaderManager.dispose();
        this.effectQueue = [];
    }
}
