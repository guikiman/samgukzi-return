import {
    normalizeAuthError,
    type AuthChangeEvent,
    type AuthClient,
    type AuthError,
    type AuthOAuthCredentials,
    type AuthOAuthResult,
    type AuthSession,
    type AuthSignInCredentials,
    type AuthSignInResult,
    type AuthSignOutOptions,
    type AuthSignOutResult,
    type AuthSignUpCredentials,
    type AuthSignUpResult,
    type AuthState,
    type AuthUnsubscribe,
} from './contracts.js';
import type { GuestSession, GuestSessionClient } from './local-guest-session.js';

export interface AuthStoreSnapshot {
    readonly state: AuthState;
    readonly guestSession: GuestSession | null;
}
export type AuthStoreListener = (snapshot: AuthStoreSnapshot) => void;
export interface AuthStoreOptions {
    readonly guestClient?: GuestSessionClient;
    readonly fallbackToGuest?: boolean;
    readonly now?: () => number;
}

const AUTH_EVENTS: ReadonlySet<AuthChangeEvent> = new Set([
    'INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'PASSWORD_RECOVERY',
    'USER_UPDATED', 'MFA_CHALLENGE_VERIFIED',
]);

export class AuthStore {
    private state: AuthState = { status: 'loading' };
    private guest: GuestSession | null = null;
    private readonly client: AuthClient;
    private readonly listeners = new Set<AuthStoreListener>();
    private readonly clientUnsubscribe: AuthUnsubscribe;
    private readonly guestClient: GuestSessionClient | undefined;
    private readonly fallbackToGuest: boolean;
    private readonly now: () => number;
    private disposed = false;

    public constructor(client: AuthClient, options: AuthStoreOptions = {}) {
        this.client = client;
        this.clientUnsubscribe = client.onAuthStateChange((event, session) => this.onProviderEvent(event, session));
        this.guestClient = options.guestClient;
        this.fallbackToGuest = options.fallbackToGuest ?? true;
        this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    }

    public getState(): AuthState { return this.state; }
    public getSnapshot(): AuthStoreSnapshot { return { state: this.state, guestSession: this.guest }; }
    public getGuestSession(): GuestSession | null { return this.guest; }
    public get isDisposed(): boolean { return this.disposed; }

    public subscribe(listener: AuthStoreListener): AuthUnsubscribe {
        if (this.disposed) return () => undefined;
        this.listeners.add(listener);
        listener(this.getSnapshot());
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            this.listeners.delete(listener);
        };
    }

    public async restoreSession(): Promise<AuthState> {
        return this.restoreOrRefresh((client) => client.getSession());
    }

    public async refreshSession(): Promise<AuthState> {
        return this.restoreOrRefresh((client) => client.refreshSession());
    }

    public async signIn(credentials: AuthSignInCredentials): Promise<AuthSignInResult> {
        this.setState({ status: 'loading' });
        if (this.guestClient !== undefined && this.guest !== null) {
            const guestResult = await this.guestClient.signOut();
            if (guestResult.error !== null) {
                this.setState({ status: 'error', error: guestResult.error });
                return { data: null, error: guestResult.error };
            }
            this.guest = null;
        }
        const result = await this.client.signIn(credentials);
        if (result.error !== null) this.setState({ status: 'error', error: result.error });
        else {
            this.guest = null;
            this.setState({ status: 'authenticated', session: result.data.session });
        }
        return result;
    }

    public async signUp(credentials: AuthSignUpCredentials): Promise<AuthSignUpResult> {
        this.setState({ status: 'loading' });
        const result = await this.client.signUp(credentials);
        if (result.error !== null) this.setState({ status: 'error', error: result.error });
        else if (result.data.session === null) this.setState({ status: 'anonymous' });
        else {
            this.guest = null;
            this.setState({ status: 'authenticated', session: result.data.session });
        }
        return result;
    }

    public async signInWithOAuth(credentials: AuthOAuthCredentials): Promise<AuthOAuthResult> {
        this.setState({ status: 'loading' });
        const result = await this.client.signInWithOAuth(credentials);
        if (result.error !== null) this.setState({ status: 'error', error: result.error });
        return result;
    }

    public async signOut(options?: AuthSignOutOptions): Promise<AuthSignOutResult> {
        this.setState({ status: 'loading' });
        const result = await this.client.signOut(options);
        if (result.error !== null) {
            this.setState({ status: 'error', error: result.error });
            return result;
        }
        if (this.guestClient !== undefined && this.guest !== null) {
            const guestResult = await this.guestClient.signOut();
            if (guestResult.error !== null) {
                this.setState({ status: 'error', error: guestResult.error });
                return result;
            }
        }
        this.guest = null;
        this.setState({ status: 'anonymous' });
        return result;
    }

    public checkSessionExpiry(): AuthState {
        if (this.state.status === 'authenticated' && this.state.session.expiresAt <= this.now()) {
            const error: AuthError = { code: 'session_expired', message: 'The session has expired', retryable: false };
            this.setState({ status: 'error', error });
        } else if (this.state.status === 'anonymous' && this.guest !== null && this.guest.expiresAt <= this.now()) {
            this.guest = null;
            this.emit();
        }
        return this.state;
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.clientUnsubscribe();
        this.listeners.clear();
        this.guest = null;
        this.state = { status: 'loading' };
    }

    private onProviderEvent(event: AuthChangeEvent, session: AuthSession | null): void {
        if (this.disposed) return;
        if (event === 'SIGNED_OUT') {
            this.guest = null;
            this.setState({ status: 'anonymous' });
        } else if (AUTH_EVENTS.has(event)) {
            this.guest = null;
            this.setState(session === null ? { status: 'anonymous' } : { status: 'authenticated', session });
        }
    }

    private async restoreOrRefresh(operation: (client: AuthClient) => ReturnType<AuthClient['getSession']>): Promise<AuthState> {
        this.setState({ status: 'loading' });
        try {
            const result = await operation(this.client);
            if (result.error !== null && this.fallbackToGuest && this.guestClient !== undefined) {
                const guestResult = await this.guestClient.signInAsGuest();
                if (guestResult.error !== null) {
                    this.setState({ status: 'error', error: guestResult.error });
                } else {
                    this.guest = guestResult.data;
                    this.setState({ status: 'anonymous' });
                }
            } else if (result.error !== null) {
                this.setState({ status: 'error', error: result.error });
            } else if (result.data.session === null) {
                this.guest = this.guestClient === undefined ? null : (await this.guestClient.getSession()).data;
                this.setState({ status: 'anonymous' });
            } else {
                this.guest = null;
                this.setState({ status: 'authenticated', session: result.data.session });
            }
        } catch (error) {
            this.setState({ status: 'error', error: normalizeAuthError(error) });
        }
        return this.state;
    }

    private setState(state: AuthState): void {
        if (this.disposed) return;
        this.state = state;
        this.emit();
    }

    private emit(): void {
        if (this.disposed) return;
        const snapshot = this.getSnapshot();
        for (const listener of [...this.listeners]) listener(snapshot);
    }
}

export class ObservableAuthStore extends AuthStore {}

export function createAuthStore(client: AuthClient, options?: AuthStoreOptions): AuthStore {
    return new AuthStore(client, options);
}
