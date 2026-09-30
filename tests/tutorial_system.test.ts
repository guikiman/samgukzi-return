/**
 * [461-480] 튜토리얼 시스템 단위 테스트
 * 파일: tests/tutorial_system.test.ts
 *
 * 단계 이동 규칙(경계 클램프), 렌더 결과 순수성, localStorage 완료 기록을 검증한다.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TutorialSystem, TUTORIAL_STEPS } from '../src/core/tutorial_system.js';

describe('[461-480] TutorialSystem', () => {
    let storage: Record<string, string>;

    beforeEach(() => {
        // jsdom이 아닌 환경에서도 localStorage 흐름을 검증할 수 있게 스텁
        storage = {};
        vi.stubGlobal('localStorage', {
            getItem: (k: string) => storage[k] ?? null,
            setItem: (k: string, v: string) => { storage[k] = v; },
            removeItem: (k: string) => { delete storage[k]; },
        });
    });

    it('초기 상태는 1단계이며 이전으로 이동할 수 없다', () => {
        const t = new TutorialSystem();
        t.start();
        const r = t.renderStep();
        expect(r.step).toBe(1);
        expect(r.totalSteps).toBe(TUTORIAL_STEPS.length);
        expect(r.isFirst).toBe(true);
        expect(r.isLast).toBe(false);
        t.prev(); // 경계 클램프
        expect(t.renderStep().step).toBe(1);
    });

    it('next/prev가 1단계씩 이동하며 마지막에서 클램프된다', () => {
        const t = new TutorialSystem();
        t.start();
        t.next();
        t.next();
        expect(t.renderStep().step).toBe(3);
        t.prev();
        expect(t.renderStep().step).toBe(2);
        for (let i = 0; i < 20; i++) t.next(); // 끝까지 밀어도 안전
        const last = t.renderStep();
        expect(last.step).toBe(TUTORIAL_STEPS.length);
        expect(last.isLast).toBe(true);
    });

    it('renderStep은 제목/본문/단계 점을 포함한 HTML을 반환한다', () => {
        const t = new TutorialSystem();
        t.start();
        const r = t.renderStep();
        expect(r.html).toContain('tut-title');
        expect(r.html).toContain('tut-body');
        expect(r.html).toContain('tut-dot active');
        expect(r.html).toContain('tut-dots');
    });

    it('완료 기록 후 shouldShowOnStart가 false가 된다', () => {
        const t = new TutorialSystem();
        expect(t.shouldShowOnStart()).toBe(true); // 첫 플레이
        t.complete();
        expect(t.shouldShowOnStart()).toBe(false); // 재시작 시 미표시
        expect(storage['samgukzi_return_tutorial_done']).toBe('done');
    });

    it('reset으로 완료 기록을 지우면 다시 첫 플레이처럼 동작한다', () => {
        const t = new TutorialSystem();
        t.complete();
        t.reset();
        expect(t.shouldShowOnStart()).toBe(true);
    });

    it('스포트라이트 셀렉터는 단계별로 노출되고 welcome 단계에는 없다', () => {
        const t = new TutorialSystem();
        t.start();
        expect(t.currentSpotlightSelector()).toBeNull(); // welcome — 도구바 비활성 상태
        t.next();
        expect(t.currentSpotlightSelector()).toBe('#btn-next-month');
        t.next();
        expect(t.currentSpotlightSelector()).toBe('#btn-report');
    });

    it('스포트라이트 대상을 못 찾을 때의 폴백 설명을 제공한다', () => {
        const t = new TutorialSystem();
        t.start();
        t.next(); // turn 단계
        expect(t.currentSpotlightFallback()).toContain('도구바');
    });

    it('스포트라이트 없는 단계는 폴백도 null이다', () => {
        const t = new TutorialSystem();
        t.start();
        expect(t.currentSpotlightFallback()).toBeNull(); // welcome
    });
});
