/**
 * [461-480] 온보딩 패널 렌더 단위 테스트
 * 파일: tests/onboarding_panel.test.ts
 *
 * 소유권(ONBOARDING-WORKTREES.md PR2): 대상은 src/ui/onboarding_panel.ts.
 * 이 테스트는 그 모듈을 "명세"로 삼는다. 구현이 없으면 모듈 해석 실패로
 * 전부 red 가 되고, PR2 가 병합되면 green 이 된다.
 *
 * 계약을 명시한다 (코디네이터 배선 지점 = 이 data-* 속성들):
 *   renderOnboardingPanel(state) -> string
 *   반환값은 DOM 이 아니라 순수 HTML 문자열이어야 한다(DOM 없는 node 환경에서 호출 가능).
 *   코디네이터가 바인딩에 필요한 값은 전부 data-* 속성으로 노출한다:
 *     data-onboarding-id        현재 단계 id
 *     data-onboarding-step      현재 단계 (0-based)
 *     data-onboarding-total     전체 단계 수
 *     data-onboarding-first     첫 단계 여부 ("true"/"false")
 *     data-onboarding-last      마지막 단계 여부 ("true"/"false")
 *     data-onboarding-spotlight 스포트라이트 대상 셀렉터 (없으면 속성 자체를 생략)
 */

import { describe, it, expect } from 'vitest';
import { renderOnboardingPanel } from '../src/ui/onboarding_panel.js';
import {
    createInitialOnboardingState,
    goToStep,
    ONBOARDING_TOTAL_STEPS,
} from '../src/core/onboarding_state.js';
import type { OnboardingState } from '../src/core/onboarding_state.js';

const LAST_INDEX = ONBOARDING_TOTAL_STEPS - 1;

/** 코디네이터가 배선에 반드시 필요로 하는 속성 */
const REQUIRED_ATTRS = [
    'data-onboarding-id',
    'data-onboarding-step',
    'data-onboarding-total',
] as const;

/** resolve 되지 않은 템플릿 산출물 — 렌더 버그의 대표 증상 */
const ARTIFACTS = ['undefined', 'NaN', '[object Object]', 'null'] as const;

function renderAt(stepIndex: number): string {
    return renderOnboardingPanel(goToStep(createInitialOnboardingState(), stepIndex));
}

describe('[461-480] 온보딩 패널 · HTML 문자열을 반환한다', () => {
    it('렌더 결과는 비어 있지 않은 문자열이다', () => {
        const html = renderOnboardingPanel(createInitialOnboardingState());
        expect(typeof html).toBe('string');
        expect(html.length).toBeGreaterThan(0);
    });

    it('DOM 이 아닌 문자열을 돌려준다 (node 환경에서 호출 가능해야 한다)', () => {
        const html = renderOnboardingPanel(createInitialOnboardingState());
        expect(typeof html).not.toBe('object');
        // 렌더 결과 자체는 태그 문자열이지 라이브 노드가 아니다
        expect(html.trim().startsWith('<')).toBe(true);
    });

    it('미해결 템플릿 산출물이 새지 않는다', () => {
        // 첫/중간/마지막을 모두 돌려 모든 분기를 검사한다
        const samples = [renderAt(0), renderAt(Math.floor(LAST_INDEX / 2)), renderAt(LAST_INDEX)];
        for (const html of samples) {
            for (const artifact of ARTIFACTS) {
                expect(html, `렌더 결과에 "${artifact}" 가 섞였다`).not.toContain(artifact);
            }
        }
    });

    it('같은 입력으로 두 번 렌더하면 결과가 동일하다', () => {
        expect(renderOnboardingPanel(createInitialOnboardingState()))
            .toBe(renderOnboardingPanel(createInitialOnboardingState()));
        expect(renderAt(2)).toBe(renderAt(2));
    });

    it('렌더 순서를 바꿔도 같은 단계의 결과는 같다', () => {
        // 정방향/역방향 렌더가 같은 단계에 대해 같은 출력을 내는지 본다.
        // (배열 자체의 순서는 뒤집히므로 단계별로 비교해야 한다)
        const forward = [0, 1, 2].map(renderAt);
        const backward = [2, 1, 0].map(renderAt).reverse();
        expect(forward).toEqual(backward);
    });
});

describe('[461-480] 온보딩 패널 · 배선용 data-* 속성', () => {
    it('코디네이터가 필요한 data-* 속성이 모두 있다', () => {
        const html = renderOnboardingPanel(createInitialOnboardingState());
        for (const attr of REQUIRED_ATTRS) {
            expect(html, `${attr} 없음`).toContain(attr);
        }
    });

    it('현재 단계와 전체 단계 수가 속성으로 노출된다', () => {
        const html = renderAt(2);
        const step = /data-onboarding-step="(\d+)"/.exec(html);
        const total = /data-onboarding-total="(\d+)"/.exec(html);
        expect(step, 'data-onboarding-step 파싱 실패').not.toBeNull();
        expect(total, 'data-onboarding-total 파싱 실패').not.toBeNull();
        expect(Number(step![1])).toBe(2);
        expect(Number(total![1])).toBe(ONBOARDING_TOTAL_STEPS);
    });

    it('단계 id 가 속성으로 노출된다', () => {
        const html = renderOnboardingPanel(createInitialOnboardingState());
        const id = /data-onboarding-id="([^"]*)"/.exec(html);
        expect(id, 'data-onboarding-id 파싱 실패').not.toBeNull();
        expect(id![1].trim()).not.toBe('');
    });

    it('첫 단계와 마지막 단계 여부가 속성으로 구분된다', () => {
        const first = /data-onboarding-first="(true|false)"/.exec(renderAt(0));
        const last = /data-onboarding-last="(true|false)"/.exec(renderAt(LAST_INDEX));
        expect(first, 'data-onboarding-first 파싱 실패').not.toBeNull();
        expect(last, 'data-onboarding-last 파싱 실패').not.toBeNull();
        expect(first![1]).toBe('true');
        expect(last![1]).toBe('true');
    });

    it('모든 단계에서 속성 세트가 동일하다 (분기별 속성 유실 금지)', () => {
        for (let i = 0; i <= LAST_INDEX; i++) {
            const html = renderAt(i);
            for (const attr of REQUIRED_ATTRS) {
                expect(html, `${i} 단계에서 ${attr} 없음`).toContain(attr);
            }
        }
    });
});

describe('[461-480] 온보딩 패널 · 단계별 내용이 바뀐다', () => {
    it('서로 다른 단계는 서로 다른 HTML 을 낸다', () => {
        expect(renderAt(0)).not.toBe(renderAt(1));
    });

    it('경계를 벗어난 단계 인덱스에 대해서도 렌더된다', () => {
        // 방어 코드 확인 — 나이/범위 밖 인덱스가 새지 않아야 한다
        for (const bad of [-5, 9999]) {
            const html = renderOnboardingPanel(
                goToStep(createInitialOnboardingState(), bad) as OnboardingState,
            );
            expect(typeof html).toBe('string');
            expect(html).not.toContain('undefined');
            expect(html).not.toContain('NaN');
        }
    });
});
