// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
    createGuestSession,
    normalizeAuthError,
    renderAuthStateFixture,
    TEST_AUTH_SESSION,
} from '../../support/auth/index.js';
import type { AuthState, GuestSession } from '../../support/auth/index.js';

function required<T extends Element>(root: ParentNode, selector: string): T {
    const element = root.querySelector<T>(selector);
    if (element === null) throw new Error(`Missing auth fixture element: ${selector}`);
    return element;
}

function mount(state: AuthState, guestSession: GuestSession | null = null): HTMLElement {
    const root = renderAuthStateFixture(state, { guestSession });
    document.body.replaceChildren(root);
    return root;
}

describe('auth UI state accessibility contract', () => {
    beforeEach(() => {
        document.body.replaceChildren();
    });

    it('exposes a distinct state marker for every AuthState', () => {
        const states: readonly AuthState[] = [
            { status: 'loading' },
            { status: 'authenticated', session: TEST_AUTH_SESSION },
            { status: 'anonymous' },
            { status: 'error', error: normalizeAuthError({ code: 'unknown', message: 'failed' }) },
        ];

        for (const state of states) {
            const root = mount(state);
            expect(root.getAttribute('data-auth-state')).toBe(state.status);
            expect(root.getAttribute('aria-busy')).toBe(state.status === 'loading' ? 'true' : 'false');
        }
    });

    it('announces loading state politely and does not expose controls', () => {
        const root = mount({ status: 'loading' });
        const status = required<HTMLParagraphElement>(root, '[role="status"]');

        expect(status.getAttribute('aria-live')).toBe('polite');
        expect(status.textContent).toContain('세션');
        expect(root.querySelector('form')).toBeNull();
        expect(root.querySelector('button')).toBeNull();
    });

    it('labels the authenticated state and exposes a safe sign-out action', () => {
        const root = mount({ status: 'authenticated', session: TEST_AUTH_SESSION });
        const heading = required<HTMLHeadingElement>(root, 'h2');
        const signOut = required<HTMLButtonElement>(root, '[data-auth-action="sign-out"]');

        expect(root.getAttribute('aria-labelledby')).toBe(heading.id);
        expect(required<HTMLElement>(root, '[data-auth-user-id]').getAttribute('data-auth-user-id')).toBe('user-test-1');
        expect(signOut.type).toBe('button');
        expect(root.textContent).not.toContain('accessToken');
        expect(root.textContent).not.toContain('refreshToken');
    });

    it('gives anonymous controls explicit labels and keyboard-safe button types', () => {
        const root = mount({ status: 'anonymous' });
        const form = required<HTMLFormElement>(root, 'form');
        const email = required<HTMLInputElement>(root, '#auth-test-email');
        const password = required<HTMLInputElement>(root, '#auth-test-password');
        const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));

        expect(form.getAttribute('aria-label')).toBe('이메일 인증');
        expect(required<HTMLLabelElement>(root, 'label[for="auth-test-email"]').textContent).toBe('이메일');
        expect(required<HTMLLabelElement>(root, 'label[for="auth-test-password"]').textContent).toBe('비밀번호');
        expect(email.autocomplete).toBe('email');
        expect(password.autocomplete).toBe('current-password');
        expect(buttons.map((button) => button.getAttribute('data-auth-action'))).toEqual([
            'sign-in', 'sign-up', 'oauth-google', 'guest',
        ]);
        expect(buttons.every((button) => button.type === 'button')).toBe(true);
    });

    it('uses an assertive alert and retry action for error state', () => {
        const error = normalizeAuthError({ code: 'rate_limited', message: '잠시 후 다시 시도', status: 429 });
        const root = mount({ status: 'error', error });
        const alert = required<HTMLDivElement>(root, '[role="alert"]');

        expect(alert.getAttribute('aria-live')).toBe('assertive');
        expect(alert.getAttribute('data-auth-error-code')).toBe('rate_limited');
        expect(alert.textContent).toBe('잠시 후 다시 시도');
        expect(required<HTMLButtonElement>(root, '[data-auth-action="retry"]').type).toBe('button');
        expect(root.querySelector('form')).toBeNull();
    });

    it('keeps local guest status separate from provider authentication state', () => {
        const guest = createGuestSession({ sessionId: 'guest-a11y' });
        const root = mount({ status: 'anonymous' }, guest);
        const banner = required<HTMLElement>(root, '[data-guest-session="true"]');

        expect(root.getAttribute('data-auth-state')).toBe('anonymous');
        expect(banner.getAttribute('role')).toBe('status');
        expect(banner.getAttribute('aria-label')).toBe('게스트 세션');
        expect(required<HTMLButtonElement>(root, '[data-auth-action="upgrade"]').textContent).toBe('계정으로 전환');
        expect(root.innerHTML).not.toContain('signInAnonymously');
    });
});
