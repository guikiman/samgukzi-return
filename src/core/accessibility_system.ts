/**
 * [461-480] 마이크로 UX · 접근성 옵션 시스템
 * 파일: src/core/accessibility_system.ts
 *
 * 설계:
 * - 글꼴 실시간 전환 (세리프/산세리프/고대비) [가독성 높은 글꼴 옵션]
 * - 화면 흔들림(Screen Shake) 토글 [동적 UI/UX]
 * - 글자 크기 배율 (0.9 / 1.0 / 1.15 / 1.3)
 * - 설정은 localStorage에 저장 — 재방문 시 복원 [17]
 * - applySettings는 순수 CSS 변수/속성 대입만 수행 — DOM 구조 변경 없음
 */

export type FontMode = 'serif' | 'sans' | 'contrast';
export type TextScale = 0.9 | 1.0 | 1.15 | 1.3;

export interface AccessibilitySettings {
    readonly fontMode: FontMode;
    readonly textScale: TextScale;
    /** 화면 흔들림 효과 on/off [동적 UI/UX] */
    readonly screenShake: boolean;
    /** 무장 이름 옆 능력치 숫자 표시 (정보 과잉 민감자용) */
    readonly showStatNumbers: boolean;
    /**
     * 대사를 화면에 한 글자씩 띄우는가(타이포그래피).
     * false 면 한 번에 다 보인다 — 모션 민감자용.
     */
    readonly typewriter: boolean;
    /**
     * 대사를 음성으로 읽는가(TTS).
     * 기본 false — 소리를 내는 것은 사용자가 먼저 골라야 한다.
     */
    readonly speech: boolean;
}

export const DEFAULT_ACCESSIBILITY: AccessibilitySettings = {
    fontMode: 'serif',
    textScale: 1.0,
    screenShake: true,
    showStatNumbers: true,
    typewriter: true,
    speech: false,
};

export const FONT_MODE_LABELS: Record<FontMode, string> = {
    serif: '명조체 (기본)',
    sans: '고딕체',
    contrast: '고대비 굵은 글씨',
};

export const TEXT_SCALE_LABELS: Record<TextScale, string> = {
    0.9: '작게 90%',
    1.0: '보통 100%',
    1.15: '크게 115%',
    1.3: '아주 크게 130%',
};

const STORAGE_KEY = 'samgukzi_return_accessibility';

export function loadAccessibilitySettings(): AccessibilitySettings {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
        if (!raw) return { ...DEFAULT_ACCESSIBILITY };
        const parsed = JSON.parse(raw) as Partial<AccessibilitySettings>;
        const fontMode = parsed.fontMode === 'sans' || parsed.fontMode === 'contrast' ? parsed.fontMode : 'serif';
        const textScale = parsed.textScale === 0.9 || parsed.textScale === 1.15 || parsed.textScale === 1.3 ? parsed.textScale : 1.0;
        return {
            fontMode,
            textScale,
            screenShake: parsed.screenShake !== false,
            showStatNumbers: parsed.showStatNumbers !== false,
            // 저장된 값이 없으면 기본값을 쓴다. typewriter/speech 는 새로 늘어난 키다.
            typewriter: parsed.typewriter !== false,
            speech: parsed.speech === true,
        };
    } catch {
        return { ...DEFAULT_ACCESSIBILITY };
    }
}

export function saveAccessibilitySettings(s: AccessibilitySettings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
        // 스토리지 불가 환경 무시
    }
}

/** data-* 속성 맵 — main.ts가 document.body에 대입 */
export function accessibilityAttributes(s: AccessibilitySettings): Record<string, string> {
    return {
        'data-font-mode': s.fontMode,
        'data-text-scale': String(s.textScale),
        'data-screen-shake': s.screenShake ? 'on' : 'off',
        'data-stat-numbers': s.showStatNumbers ? 'on' : 'off',
        'data-typewriter': s.typewriter ? 'on' : 'off',
        'data-speech': s.speech ? 'on' : 'off',
    };
}

/** 설정 패널 본문 HTML — 순수 문자열 (단위 테스트 가능) */
export function renderAccessibilityPanel(s: AccessibilitySettings): string {
    const fontOptions = (Object.keys(FONT_MODE_LABELS) as FontMode[])
        .map((m) => `<button class="a11y-option${m === s.fontMode ? ' active' : ''}" data-font="${m}">${FONT_MODE_LABELS[m]}</button>`)
        .join('');
    const scaleOptions = (Object.keys(TEXT_SCALE_LABELS) as unknown as TextScale[])
        .map((v) => `<button class="a11y-option${Number(v) === s.textScale ? ' active' : ''}" data-scale="${v}">${TEXT_SCALE_LABELS[v]}</button>`)
        .join('');
    return (
        `<div class="a11y-row"><span class="a11y-label">글꼴</span><span class="a11y-opts">${fontOptions}</span></div>` +
        `<div class="a11y-row"><span class="a11y-label">글자 크기</span><span class="a11y-opts">${scaleOptions}</span></div>` +
        `<div class="a11y-row"><span class="a11y-label">화면 흔들림</span><span class="a11y-opts">` +
        `<button class="a11y-option${s.screenShake ? ' active' : ''}" data-shake="on">켜기</button>` +
        `<button class="a11y-option${!s.screenShake ? ' active' : ''}" data-shake="off">끄기</button>` +
        `</span></div>` +
        `<div class="a11y-row"><span class="a11y-label">능력치 숫자</span><span class="a11y-opts">` +
        `<button class="a11y-option${s.showStatNumbers ? ' active' : ''}" data-stat="on">표시</button>` +
        `<button class="a11y-option${!s.showStatNumbers ? ' active' : ''}" data-stat="off">숨김</button>` +
        `</span></div>` +
        `<div class="a11y-row"><span class="a11y-label">대사 표시</span><span class="a11y-opts">` +
        `<button class="a11y-option${s.typewriter ? ' active' : ''}" data-typewriter="on">한 글자씩</button>` +
        `<button class="a11y-option${!s.typewriter ? ' active' : ''}" data-typewriter="off">한 번에</button>` +
        `</span></div>` +
        `<div class="a11y-row"><span class="a11y-label">대사 읽기</span><span class="a11y-opts">` +
        `<button class="a11y-option${s.speech ? ' active' : ''}" data-speech="on">듣기</button>` +
        `<button class="a11y-option${!s.speech ? ' active' : ''}" data-speech="off">끄기</button>` +
        `</span></div>` +
        `<div class="ss-hint">설정은 즉시 적용되며 자동 저장됩니다</div>`
    );
}
