import type { AuthState, GuestSession } from './auth-view-model.js';

export const AUTH_FIXTURE_ROOT_ID = 'auth-test-root';

function assertNever(value: never): never {
    throw new Error(`Unexpected auth UI state: ${JSON.stringify(value)}`);
}

function setAttributes(element: HTMLElement, attributes: Readonly<Record<string, string>>): void {
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
}

function createButton(action: string, label: string): HTMLButtonElement {
    const button = document.createElement('button');
    setAttributes(button, { type: 'button', 'data-auth-action': action, class: `auth-btn auth-btn-${action}` });
    button.textContent = label;
    return button;
}

function createHeading(text: string): HTMLHeadingElement {
    const heading = document.createElement('h2');
    heading.id = 'auth-test-title';
    heading.tabIndex = -1;
    heading.setAttribute('data-auth-title', 'true');
    heading.textContent = text;
    return heading;
}

function createGuestBanner(session: GuestSession): HTMLElement {
    const banner = document.createElement('aside');
    setAttributes(banner, {
        role: 'status',
        'aria-label': '게스트 세션',
        'data-guest-session': 'true',
    });
    const text = document.createElement('p');
    text.textContent = `게스트로 진행 중: ${session.user.displayName ?? '게스트'}`;
    banner.append(text, createButton('upgrade', '계정으로 전환'));
    return banner;
}

function renderLoading(root: HTMLElement): void {
    root.append(createHeading('세션 확인 중'));
    const status = document.createElement('p');
    setAttributes(status, { role: 'status', 'aria-live': 'polite' });
    status.textContent = '저장된 인증 세션을 확인하고 있습니다.';
    root.append(status);
}

function renderAuthenticated(root: HTMLElement, state: Extract<AuthState, { status: 'authenticated' }>): void {
    root.setAttribute('aria-labelledby', 'auth-test-title');
    root.append(createHeading('계정 인증됨'));
    const details = document.createElement('p');
    setAttributes(details, { 'data-auth-user-id': state.session.user.id });
    details.textContent = state.session.user.displayName ?? state.session.user.email ?? '플레이어';
    root.append(details, createButton('sign-out', '로그아웃'));
}

function renderAnonymous(root: HTMLElement): void {
    root.setAttribute('aria-labelledby', 'auth-test-title');
    root.append(createHeading('계정 로그인'));
    const form = document.createElement('form');
    setAttributes(form, { 'aria-label': '이메일 인증', 'data-auth-form': 'credentials' });
    const emailLabel = document.createElement('label');
    emailLabel.htmlFor = 'auth-test-email';
    emailLabel.textContent = '이메일';
    const email = document.createElement('input');
    setAttributes(email, { id: 'auth-test-email', name: 'email', type: 'email', autocomplete: 'email' });
    const passwordLabel = document.createElement('label');
    passwordLabel.htmlFor = 'auth-test-password';
    passwordLabel.textContent = '비밀번호';
    const password = document.createElement('input');
    setAttributes(password, { id: 'auth-test-password', name: 'password', type: 'password', autocomplete: 'current-password' });
    form.append(emailLabel, email, passwordLabel, password);
    form.append(
        createButton('sign-in', '로그인'),
        createButton('sign-up', '회원가입'),
        createButton('oauth-google', 'Google로 계속'),
        createButton('guest', '게스트로 시작'),
    );
    root.append(form);
}

function renderError(root: HTMLElement, state: Extract<AuthState, { status: 'error' }>): void {
    root.setAttribute('aria-labelledby', 'auth-test-title');
    root.append(createHeading('인증 오류'));
    const alert = document.createElement('div');
    setAttributes(alert, { role: 'alert', 'aria-live': 'assertive', 'data-auth-error-code': state.error.code, tabindex: '-1' });
    alert.textContent = state.error.code === 'session_expired' ? '인증 세션이 만료되었습니다. 다시 로그인해 주세요.' : state.error.message;
    root.append(alert, createButton('retry', '다시 시도'));
}

export interface AuthUiFixtureOptions {
    readonly guestSession?: GuestSession | null;
}

/** Build a deterministic, provider-free auth surface for DOM and browser probes. */
export function renderAuthStateFixture(
    state: AuthState,
    options: AuthUiFixtureOptions = {},
): HTMLElement {
    const root = document.createElement('section');
    root.id = AUTH_FIXTURE_ROOT_ID;
    root.setAttribute('data-auth-state', state.status);
    root.setAttribute('aria-busy', state.status === 'loading' ? 'true' : 'false');

    switch (state.status) {
        case 'loading':
            renderLoading(root);
            break;
        case 'authenticated':
            renderAuthenticated(root, state);
            break;
        case 'anonymous':
            renderAnonymous(root);
            break;
        case 'error':
            renderError(root, state);
            break;
        default:
            assertNever(state);
    }

    if (options.guestSession !== undefined && options.guestSession !== null && state.status === 'anonymous') {
        root.append(createGuestBanner(options.guestSession));
    }
    return root;
}

export interface AuthPanelActions {
    onSignIn?(credentials: { email: string; password: string }): void | Promise<void>;
    onSignUp?(credentials: { email: string; password: string }): void | Promise<void>;
    onOAuth?(provider: string): void | Promise<void>;
    onGuest?(): void | Promise<void>;
    onSignOut?(): void | Promise<void>;
    onRetry?(): void | Promise<void>;
    onUpgrade?(): void | Promise<void>;
    onClose?(): void;
}

export interface AuthPanelOptions extends AuthUiFixtureOptions {
    readonly actions?: AuthPanelActions;
}

export function bindAuthPanelEvents(root: HTMLElement, actions?: AuthPanelActions): void {
    if (!actions) return;

    const signInBtn = root.querySelector<HTMLButtonElement>('[data-auth-action="sign-in"]');
    const signUpBtn = root.querySelector<HTMLButtonElement>('[data-auth-action="sign-up"]');
    const oauthGoogleBtn = root.querySelector<HTMLButtonElement>('[data-auth-action="oauth-google"]');
    const guestBtn = root.querySelector<HTMLButtonElement>('[data-auth-action="guest"]');
    const signOutBtn = root.querySelector<HTMLButtonElement>('[data-auth-action="sign-out"]');
    const retryBtn = root.querySelector<HTMLButtonElement>('[data-auth-action="retry"]');
    const upgradeBtn = root.querySelector<HTMLButtonElement>('[data-auth-action="upgrade"]');

    const getCredentials = () => {
        const emailInput = root.querySelector<HTMLInputElement>('#auth-test-email');
        const passwordInput = root.querySelector<HTMLInputElement>('#auth-test-password');
        return {
            email: emailInput?.value.trim() ?? '',
            password: passwordInput?.value ?? '',
        };
    };

    root.querySelector<HTMLFormElement>('form[data-auth-form="credentials"]')?.addEventListener('submit', (event) => {
        event.preventDefault();
        actions.onSignIn?.(getCredentials());
    });

    signInBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        actions.onSignIn?.(getCredentials());
    });

    signUpBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        actions.onSignUp?.(getCredentials());
    });

    oauthGoogleBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        actions.onOAuth?.('google');
    });

    guestBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        actions.onGuest?.();
    });

    signOutBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        actions.onSignOut?.();
    });

    retryBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        actions.onRetry?.();
    });

    upgradeBtn?.addEventListener('click', (e) => {
        e.preventDefault();
        actions.onUpgrade?.();
    });
}

/**
 * Render the accessible auth panel into a target container with interactive event bindings.
 */
export function renderAuthPanel(
    container: HTMLElement,
    state: AuthState,
    options: AuthPanelOptions = {},
): HTMLElement {
    const root = renderAuthStateFixture(state, options);
    bindAuthPanelEvents(root, options.actions);
    container.replaceChildren(root);
    return root;
}


