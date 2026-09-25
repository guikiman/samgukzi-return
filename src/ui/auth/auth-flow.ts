import { AuthViewModel, normalizeAuthError } from './auth-view-model.js';
import type {
    AuthClient,
    AuthState,
    AuthUnsubscribe,
    GuestSession,
    GuestSessionClient,
    OAuthProvider,
} from './auth-view-model.js';
import { renderAuthPanel } from './auth-panel.js';
import type { AuthPanelOptions } from './auth-panel.js';

export interface AuthFlowOptions {
    readonly client: AuthClient;
    readonly guestClient?: GuestSessionClient;
    readonly container: HTMLElement;
    readonly now?: () => number;
    readonly initialProvider?: OAuthProvider;
    readonly onStateChange?: (state: AuthState, guestSession: GuestSession | null) => void;
}

export interface AuthFlow {
    readonly viewModel: AuthViewModel;
    mount(): Promise<AuthState>;
    unmount(): void;
    signIn(credentials: { email: string; password: string }): Promise<AuthState>;
    signUp(credentials: { email: string; password: string }): Promise<AuthState>;
    signInWithOAuth(provider?: OAuthProvider): Promise<AuthState>;
    signInAsGuest(): Promise<AuthState>;
    signOut(): Promise<AuthState>;
    retry(): Promise<AuthState>;
    upgrade(): Promise<AuthState>;
    refreshSession(): Promise<AuthState>;
    checkSessionExpiry(nowSeconds?: number): AuthState;
}

const EMPTY_GUEST = null;

/** Local-session provider used when no guest client is supplied. */
function createLocalGuestClient(now: () => number): GuestSessionClient {
    let session: GuestSession | null = null;
    return {
        async signInAsGuest() {
            session = {
                sessionId: `guest-${Math.random().toString(36).slice(2, 10)}`,
                user: { id: 'local-guest', displayName: '게스트 플레이어', isAnonymous: true },
                expiresAt: now() + 86_400,
            };
            return { data: session, error: null };
        },
        async getSession() {
            return { data: session, error: null };
        },
        async signOut() {
            session = null;
            return { data: null, error: null };
        },
    };
}

function safeError(error: unknown): ReturnType<typeof normalizeAuthError> {
    return normalizeAuthError(error);
}

/**
 * Provider-neutral auth flow. The caller supplies AuthClient; no provider SDK
 * is imported here. The flow owns only the panel DOM and its subscriptions.
 */
export function createAuthFlow(options: AuthFlowOptions): AuthFlow {
    const now = options.now ?? (() => Math.floor(Date.now() / 1000));
    const guestClient = options.guestClient ?? createLocalGuestClient(now);
    const viewModel = new AuthViewModel(options.client, { guestClient, now });
    let mounted = false;
    let disposed = false;
    let stateUnsubscribe: AuthUnsubscribe | undefined;
    let lastState: AuthState = viewModel.getState();
    let lastGuest = viewModel.getGuestSession();

    const panelOptions = (): AuthPanelOptions => ({
        guestSession: viewModel.getGuestSession(),
        actions: {
            onSignIn: async (credentials) => { await flow.signIn(credentials); },
            onSignUp: async (credentials) => { await flow.signUp(credentials); },
            onOAuth: async (provider) => { await flow.signInWithOAuth(provider as OAuthProvider); },
            onGuest: async () => { await flow.signInAsGuest(); },
            onSignOut: async () => { await flow.signOut(); },
            onRetry: async () => { await flow.retry(); },
            onUpgrade: async () => { await flow.upgrade(); },
        },
    });

    const render = (state = lastState, guest = lastGuest): void => {
        if (!mounted || disposed) return;
        lastState = state;
        lastGuest = guest;
        renderAuthPanel(options.container, state, {
            guestSession: guest,
            actions: panelOptions().actions,
        });
        options.onStateChange?.(state, guest);
        const heading = options.container.querySelector<HTMLHeadingElement>('[data-auth-title]');
        if (state.status === 'error') options.container.querySelector<HTMLElement>('[role="alert"]')?.focus();
        else if (state.status === 'authenticated' || state.status === 'anonymous') heading?.focus();
    };

    const flow: AuthFlow = {
        viewModel,
        async mount() {
            if (disposed) return viewModel.getState();
            if (!mounted) {
                mounted = true;
                render();
                stateUnsubscribe = viewModel.onStateChange((state, guest) => render(state, guest));
            }
            return viewModel.initialize();
        },
        unmount() {
            if (!mounted) return;
            stateUnsubscribe?.();
            stateUnsubscribe = undefined;
            viewModel.dispose();
            options.container.replaceChildren();
            mounted = false;
            disposed = true;
        },
        async signIn(credentials) {
            if (credentials.email.trim() === '' || credentials.password === '') {
                viewModel.resetError();
                return viewModel.signIn({ email: '', password: '' });
            }
            return viewModel.signIn({ email: credentials.email.trim(), password: credentials.password });
        },
        async signUp(credentials) {
            return viewModel.signUp({ email: credentials.email.trim(), password: credentials.password });
        },
        async signInWithOAuth(provider = options.initialProvider ?? 'google') {
            return viewModel.signInWithOAuth({ provider });
        },
        async signInAsGuest() {
            return viewModel.signInAsGuest();
        },
        async signOut() {
            return viewModel.signOut();
        },
        async retry() {
            return viewModel.initialize();
        },
        async upgrade() {
            return viewModel.resetError();
        },
        async refreshSession() {
            return viewModel.refreshSession();
        },
        checkSessionExpiry(nowSeconds = now()) {
            return viewModel.checkSessionExpiry(nowSeconds);
        },
    };

    return flow;
}

export { EMPTY_GUEST };
