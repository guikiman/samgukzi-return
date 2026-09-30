/**
 * [461-480] 접근성 옵션 시스템 단위 테스트
 * 파일: tests/accessibility_system.test.ts
 *
 * 설정 로드/저장 라운드트립, 잘못된 값 폴백, 속성/패널 렌더 순수성을 검증한다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    loadAccessibilitySettings, saveAccessibilitySettings, accessibilityAttributes,
    renderAccessibilityPanel, DEFAULT_ACCESSIBILITY,
} from '../src/core/accessibility_system.js';

describe('[461-480] AccessibilitySystem', () => {
    let storage: Record<string, string>;

    beforeEach(() => {
        storage = {};
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => storage[k] ?? null,
            setItem: (k: string, v: string) => { storage[k] = v; },
            removeItem: (k: string) => { delete storage[k]; },
        });
    });

    it('저장 없이 로드하면 기본값(세리프/100%/흔들림 on/숫자 표시)이다', () => {
        const s = loadAccessibilitySettings();
        expect(s).toEqual(DEFAULT_ACCESSIBILITY);
    });

    it('저장→로드 라운드트립이 유지된다', () => {
        saveAccessibilitySettings({ fontMode: 'sans', textScale: 1.3, screenShake: false, showStatNumbers: false });
        const s = loadAccessibilitySettings();
        expect(s.fontMode).toBe('sans');
        expect(s.textScale).toBe(1.3);
        expect(s.screenShake).toBe(false);
        expect(s.showStatNumbers).toBe(false);
    });

    it('손상된 저장값은 안전하게 폴백한다', () => {
        storage['samgukzi_return_accessibility'] = '{"fontMode":"hack","textScale":7.5,"screenShake":"yes"}';
        const s = loadAccessibilitySettings();
        expect(s.fontMode).toBe('serif');
        expect(s.textScale).toBe(1.0);
        expect(s.screenShake).toBe(true);
        expect(s.showStatNumbers).toBe(true);
    });

    it('accessibilityAttributes가 body data-* 속성 맵을 만든다', () => {
        const attrs = accessibilityAttributes({ fontMode: 'contrast', textScale: 1.15, screenShake: false, showStatNumbers: true });
        expect(attrs['data-font-mode']).toBe('contrast');
        expect(attrs['data-text-scale']).toBe('1.15');
        expect(attrs['data-screen-shake']).toBe('off');
        expect(attrs['data-stat-numbers']).toBe('on');
    });

    it('renderAccessibilityPanel은 활성 옵션에 active 클래스를 붙인다', () => {
        const html = renderAccessibilityPanel({ fontMode: 'sans', textScale: 0.9, screenShake: true, showStatNumbers: false });
        expect(html).toContain('class="a11y-option active" data-font="sans"');
        expect(html).toContain('class="a11y-option" data-font="serif"');
        expect(html).toContain('class="a11y-option active" data-scale="0.9"');
        expect(html).toContain('class="a11y-option active" data-shake="on"');
        expect(html).toContain('class="a11y-option active" data-stat="off"');
        expect(html).not.toContain('class="a11y-option active" data-stat="on"');
    });
});
