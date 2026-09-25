import { normalizeAuthError } from './errors.js';
import type {
    AuthChangeEvent,
    AuthClient,
    AuthError,
    AuthOAuthCredentials,
    AuthSession,
    AuthSignInCredentials,
    AuthSignUpCredentials,
    AuthState,
    AuthUnsubscribe,
    GuestSession,
    GuestSessionClient,
} from './contracts.js';

export interface AuthStateMachineOptions {
    readonly guestClient?: GuestSessionClient;
    readonly now?: () => number;
}

export type AuthStateObserver = (state: AuthState) => void;

function assertNever(value: never): never {
    throw new Error(`Unexpected auth state: ${JSON.stringify(value)}`);
}

export function isSessionExpired(session: AuthSession, nowSeconds: number): boolean {
    return session.expiresAt <= nowSeconds;
}

function expiredError(): AuthError {
    return {
        code: 'session_expired',
        message: 'The session has expired',
        retryable: false,
    };
}

function guestUnavailableError(): AuthError {
    return normalizeAuthError({
        code: 'unknown',
        message: 'Guest sessions are not available',
        retryable: false,
    });
}

/**
 * Small state-machine harness used by auth tests until the UI adapter is
 * integrated. All time checks are explicit or clock-injected; no timers run.
 */
export class AuthStateMachine {
    private state: AuthState = { status: 'loading' };
    private guest: GuestSession | null = null;
    private readonly observers = new Set<AuthStateObserver>();
    private readonly clientUnsubscribe: AuthUnsubscribe;
    private readonly guestClient: GuestSessionClient | undefined;
    private readonly now: () => number;
    private disposed = false;

    public constructor(
        private readonly client: AuthClient,
        options: AuthStateMachineOptions = {},
    ) {
        this.guestClient = options.guestClient;
        this.now = options.now ?? (() => 0);
        this.clientUnsubscribe = client.onAuthStateChange((event, session) => {
            this.handleClientEvent(event, session);
        });
    }

    public getState(): AuthState {
        return this.state;
    }

    public getGuestSession(): GuestSession | null {
        return this.guest;
    }

    public get listenerCount(): number {
        return this.observers.size;
    }

    public get isDisposed(): boolean {
        return this.disposed;
    }

    public onStateChange(observer: AuthStateObserver): AuthUnsubscribe {
        if (this.disposed) return () => undefined;
        this.observers.add(observer);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            this.observers.delete(observer);
        };
    }

    public async initialize(): Promise<AuthState> {
        this.update({ status: 'loading' });
        const result = await this.client.getSession();
        if (result.error !== null) {
            return this.update({ status: 'error', error: result.error });
        }
        return result.data.session === null
            ? this.update({ status: 'anonymous' })
            : this.update({ status: 'authenticated', session: result.data.session });
    }

    public async signIn(credentials: AuthSignInCredentials): Promise<AuthState> {
        this.update({ status: 'loading' });
        const result = await this.client.signIn(credentials);
        if (result.error !== null) {
            return this.update({ status: 'error', error: result.error });
        }
        return this.update({ status: 'authenticated', session: result.data.session });
    }

    public async signUp(credentials: AuthSignUpCredentials): Promise<AuthState> {
        this.update({ status: 'loading' });
        const result = await this.client.signUp(credentials);
        if (result.error !== null) {
            return this.update({ status: 'error', error: result.error });
        }
        return result.data.session === null
            ? this.update({ status: 'anonymous' })
            : this.update({ status: 'authenticated', session: result.data.session });
    }

    public async signInWithOAuth(credentials: AuthOAuthCredentials): Promise<AuthState> {
        this.update({ status: 'loading' });
        const result = await this.client.signInWithOAuth(credentials);
        if (result.error !== null) {
            return this.update({ status: 'error', error: result.error });
        }
        return this.getState();
    }

    public async signInAsGuest(): Promise<AuthState> {
        if (this.guestClient === undefined) {
            return this.update({ status: 'error', error: guestUnavailableError() });
        }
        const result = await this.guestClient.signInAsGuest();
        if (result.error !== null) {
            return this.update({ status: 'error', error: result.error });
        }
        if (result.data === null) {
            return this.update({ status: 'error', error: guestUnavailableError() });
        }
        this.guest = result.data;
        if (this.state.status !== 'authenticated') return this.update({ status: 'anonymous' });
        return this.getState();
    }

    public async signOut(): Promise<AuthState> {
        this.update({ status: 'loading' });
        const guestResult = this.guestClient === undefined || this.guest === null
            ? { data: null, error: null }
            : await this.guestClient.signOut();
        const authResult = await this.client.signOut();
        if (guestResult.error !== null) return this.update({ status: 'error', error: guestResult.error });
        if (authResult.error !== null) return this.update({ status: 'error', error: authResult.error });
        this.guest = null;
        return this.update({ status: 'anonymous' });
    }

    public async refreshSession(): Promise<AuthState> {
        this.update({ status: 'loading' });
        const result = await this.client.refreshSession();
        if (result.error !== null) {
            return this.update({ status: 'error', error: result.error });
        }
        return result.data.session === null
            ? this.update({ status: 'anonymous' })
            : this.update({ status: 'authenticated', session: result.data.session });
    }

    public checkSessionExpiry(nowSeconds: number = this.now()): AuthState {
        if (this.state.status === 'authenticated' && isSessionExpired(this.state.session, nowSeconds)) {
            return this.update({ status: 'error', error: expiredError() });
        }
        if (this.guest !== null && isSessionExpired(this.guest, nowSeconds)) {
            this.guest = null;
            if (this.state.status === 'anonymous') return this.getState();
        }
        return this.getState();
    }

    public dispose(): void {
        if (this.disposed) return;
        this.clientUnsubscribe();
        this.observers.clear();
        this.guest = null;
        this.state = { status: 'loading' };
        this.disposed = true;
    }

    private handleClientEvent(event: AuthChangeEvent, session: AuthSession | null): void {
        if (this.disposed) return;
        switch (event) {
            case 'INITIAL_SESSION':
            case 'SIGNED_IN':
            case 'TOKEN_REFRESHED':
            case 'PASSWORD_RECOVERY':
            case 'USER_UPDATED':
            case 'MFA_CHALLENGE_VERIFIED':
                if (session === null) this.update({ status: 'anonymous' });
                else this.update({ status: 'authenticated', session });
                return;
            case 'SIGNED_OUT':
                this.guest = null;
                this.update({ status: 'anonymous' });
                return;
            default:
                assertNever(event);
        }
    }

    private update(next: AuthState): AuthState {
        if (this.disposed) return this.state;
        this.state = next;
        for (const observer of [...this.observers]) observer(next);
        return next;
    }
}
