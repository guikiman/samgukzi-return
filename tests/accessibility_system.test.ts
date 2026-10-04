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
        saveAccessibilitySettings({ ...DEFAULT_ACCESSIBILITY, fontMode: 'sans', textScale: 1.3, screenShake: false, showStatNumbers: false });
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
        const attrs = accessibilityAttributes({ ...DEFAULT_ACCESSIBILITY, fontMode: 'contrast', textScale: 1.15, screenShake: false, showStatNumbers: true });
        expect(attrs['data-font-mode']).toBe('contrast');
        expect(attrs['data-text-scale']).toBe('1.15');
        expect(attrs['data-screen-shake']).toBe('off');
        expect(attrs['data-stat-numbers']).toBe('on');
    });

    it('renderAccessibilityPanel은 활성 옵션에 active 클래스를 붙인다', () => {
        const html = renderAccessibilityPanel({ ...DEFAULT_ACCESSIBILITY, fontMode: 'sans', textScale: 0.9, screenShake: true, showStatNumbers: false });
        expect(html).toContain('class="a11y-option active" data-font="sans"');
        expect(html).toContain('class="a11y-option" data-font="serif"');
        expect(html).toContain('class="a11y-option active" data-scale="0.9"');
        expect(html).toContain('class="a11y-option active" data-shake="on"');
        expect(html).toContain('class="a11y-option active" data-stat="off"');
        expect(html).not.toContain('class="a11y-option active" data-stat="on"');
    });

    // ------------------------------------------------------------ 대사 표시/읽기 옵션

    it('대사 한 글자씩 표시가 기본 켜짐이다', () => {
        expect(DEFAULT_ACCESSIBILITY.typewriter).toBe(true);
    });

    it('대사 읽기(음성)는 기본 꺼짐이다 — 소리는 사용자가 먼저 골라야 한다', () => {
        expect(DEFAULT_ACCESSIBILITY.speech).toBe(false);
    });

    it('대사 표시·읽기 설정도 라운드트립된다', () => {
        saveAccessibilitySettings({ ...DEFAULT_ACCESSIBILITY, typewriter: false, speech: true });
        const s = loadAccessibilitySettings();
        expect(s.typewriter).toBe(false);
        expect(s.speech).toBe(true);
    });

    it('옛 저장값(키 없음)을 읽어도 새 옵션이 안전하게 채워진다', () => {
        // 이전 버전이 저장한 JSON — typewriter/speech 키가 없다.
        storage['samgukzi_return_accessibility'] = '{"fontMode":"sans","textScale":1.0}';
        const s = loadAccessibilitySettings();
        expect(s.typewriter).toBe(true);
        expect(s.speech).toBe(false);
    });

    it('data-typewriter / data-speech 속성이 나온다', () => {
        const attrs = accessibilityAttributes({ ...DEFAULT_ACCESSIBILITY, typewriter: false, speech: true });
        expect(attrs['data-typewriter']).toBe('off');
        expect(attrs['data-speech']).toBe('on');
    });

    it('설정 패널에 대사 표시·읽기 버튼이 보인다', () => {
        const html = renderAccessibilityPanel({ ...DEFAULT_ACCESSIBILITY, typewriter: true, speech: false });
        expect(html).toContain('data-typewriter="on"');
        expect(html).toContain('data-typewriter="off"');
        expect(html).toContain('data-speech="on"');
        expect(html).toContain('data-speech="off"');
        // 기본값(typewriter on / speech off)이 활성화돼 있다
        expect(html).toContain('class="a11y-option active" data-typewriter="on"');
        expect(html).toContain('class="a11y-option active" data-speech="off"');
    });
});
