/**
 * Provider-neutral authentication boundary for the Supabase Auth foundation.
 *
 * Adapters may use Supabase `createClient(url, key, options)` and `auth.*`, but
 * callers depend only on these types. Token material remains private to the
 * adapter; the public session contains user and non-sensitive metadata only.
 */

export const OAUTH_PROVIDERS = [
    'apple', 'azure', 'bitbucket', 'discord', 'facebook', 'figma', 'github',
    'gitlab', 'google', 'kakao', 'keycloak', 'linkedin', 'linkedin_oidc',
    'notion', 'slack', 'slack_oidc', 'spotify', 'twitch', 'twitter', 'x',
    'workos', 'zoom', 'fly',
] as const;

/** Providers supported by the approved Supabase Auth foundation. */
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number] | `custom:${string}`;
export type AuthMetadata = Readonly<Record<string, unknown>>;

/** Normalized user fields safe for game/UI consumers. */
export interface AuthUser {
    readonly id: string;
    readonly email?: string;
    readonly phone?: string;
    readonly emailVerified?: boolean;
    readonly displayName?: string;
    readonly avatarUrl?: string;
    readonly provider?: string;
    readonly isAnonymous?: boolean;
    readonly createdAt?: string;
    readonly lastSignInAt?: string;
    readonly metadata?: AuthMetadata;
    readonly appMetadata?: AuthMetadata;
}

export interface AuthSession {
    readonly user: AuthUser;
    /** Unix timestamp in seconds at which the session expires. */
    readonly expiresAt: number;
    readonly provider?: string;
    readonly sessionId?: string;
    readonly providerMetadata?: AuthMetadata;
    readonly sessionMetadata?: AuthMetadata;
}

export type AuthState =
    | { readonly status: 'loading'; readonly session?: null; readonly error?: null }
    | { readonly status: 'authenticated'; readonly session: AuthSession; readonly error?: null }
    | { readonly status: 'anonymous'; readonly session?: null; readonly error?: null }
    | { readonly status: 'error'; readonly session?: null; readonly error: AuthError };

export const AUTH_ERROR_CODES = [
    'invalid_credentials', 'email_not_confirmed', 'user_already_exists', 'email_exists',
    'weak_password', 'rate_limited', 'network_error', 'provider_error', 'session_expired',
    'unknown',
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export interface AuthError {
    readonly code: AuthErrorCode;
    readonly message: string;
    readonly status?: number;
    readonly provider?: string;
    readonly retryable?: boolean;
}

export interface AuthClientConfig {
    /** Refresh an expiring session automatically. Defaults to true. */
    readonly autoRefreshToken?: boolean;
    /** Restore a persisted session on client initialization. Defaults to true. */
    readonly persistSession?: boolean;
    /** Process an OAuth callback in the current URL. Defaults to true. */
    readonly detectSessionInUrl?: boolean;
    readonly storageKey?: string;
    readonly flowType?: 'implicit' | 'pkce';
}

export interface AuthConfig {
    /** Public project URL, the first `createClient` argument. */
    readonly url: string;
    /** Public anonymous key, the second `createClient` argument. */
    readonly anonKey: string;
    /** Provider options passed as the third `createClient` argument. */
    readonly auth?: AuthClientConfig;
}

export const DEFAULT_AUTH_CLIENT_CONFIG = {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
} as const satisfies Required<Pick<AuthClientConfig, 'autoRefreshToken' | 'persistSession' | 'detectSessionInUrl'>>;

export interface EmailPasswordCredentials {
    readonly email: string;
    readonly password: string;
}

export interface AuthSignUpOptions {
    readonly emailRedirectTo?: string;
    readonly data?: AuthMetadata;
    readonly captchaToken?: string;
}

export interface AuthSignInOptions {
    readonly captchaToken?: string;
}

export type AuthSignUpCredentials = EmailPasswordCredentials & { readonly options?: AuthSignUpOptions };
export type AuthSignInCredentials = EmailPasswordCredentials & { readonly options?: AuthSignInOptions };

export interface AuthOAuthOptions {
    readonly redirectTo?: string;
    readonly scopes?: string;
    readonly queryParams?: Readonly<Record<string, string>>;
    readonly skipBrowserRedirect?: boolean;
}

export type AuthOAuthCredentials = {
    readonly provider: OAuthProvider;
    readonly options?: AuthOAuthOptions;
};

type NullData<T> = { readonly [K in keyof T]: null };

export type AuthResult<T> =
    | { readonly data: T; readonly error: null }
    | { readonly data: null; readonly error: AuthError }
    | { readonly data: NullData<T>; readonly error: AuthError };

export type AuthSignUpResult = AuthResult<{
    readonly user: AuthUser | null;
    readonly session: AuthSession | null;
}>;
export type AuthSignInResult = AuthResult<{
    readonly user: AuthUser;
    readonly session: AuthSession;
}>;
export type AuthSessionResult = AuthResult<{ readonly session: AuthSession | null }>;

export type AuthOAuthResult =
    | { readonly data: { readonly provider: OAuthProvider; readonly url: string; readonly flowId?: string | null }; readonly error: null }
    | { readonly data: { readonly provider: OAuthProvider; readonly url: null; readonly flowId?: string | null }; readonly error: AuthError };

export type AuthSignOutScope = 'global' | 'local' | 'others';
export interface AuthSignOutOptions { readonly scope?: AuthSignOutScope; }
export type AuthSignOutResult =
    | { readonly data: null; readonly error: null }
    | { readonly data: null; readonly error: AuthError };

export type AuthChangeEvent =
    | 'INITIAL_SESSION'
    | 'PASSWORD_RECOVERY'
    | 'SIGNED_IN'
    | 'SIGNED_OUT'
    | 'TOKEN_REFRESHED'
    | 'USER_UPDATED'
    | 'MFA_CHALLENGE_VERIFIED';

export type AuthUnsubscribe = () => void;
export interface AuthSubscription { readonly unsubscribe: AuthUnsubscribe; }
export type AuthStateListener = (event: AuthChangeEvent, session: AuthSession | null) => void;

export interface AuthClient {
    signUp(credentials: AuthSignUpCredentials): Promise<AuthSignUpResult>;
    /** Provider-neutral equivalent of Supabase `signInWithPassword`. */
    signIn(credentials: AuthSignInCredentials): Promise<AuthSignInResult>;
    signInWithOAuth(credentials: AuthOAuthCredentials): Promise<AuthOAuthResult>;
    /** Resolves the current or restored session. */
    getSession(): Promise<AuthSessionResult>;
    /** The returned function unsubscribes idempotently. */
    onAuthStateChange(listener: AuthStateListener): AuthUnsubscribe;
    signOut(options?: AuthSignOutOptions): Promise<AuthSignOutResult>;
    /** Refreshes the session and emits TOKEN_REFRESHED on success. */
    refreshSession(): Promise<AuthSessionResult>;
}

export type AuthClientFactory = (config: AuthConfig) => AuthClient;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStatus(record: Record<string, unknown> | undefined): number | undefined {
    const value = record?.['status'];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return undefined;
}

function isKnownErrorCode(value: unknown): value is AuthErrorCode {
    return typeof value === 'string' && AUTH_ERROR_CODES.some((code) => code === value);
}

function inferCodeFromMessage(message: string): AuthErrorCode {
    const normalized = message.toLowerCase();
    if (normalized.includes('email') && normalized.includes('confirm')) return 'email_not_confirmed';
    if (normalized.includes('already') && (normalized.includes('exist') || normalized.includes('register'))) return 'user_already_exists';
    if (normalized.includes('weak') && normalized.includes('password')) return 'weak_password';
    if (normalized.includes('rate') || normalized.includes('too many')) return 'rate_limited';
    if (normalized.includes('network') || normalized.includes('fetch')) return 'network_error';
    if (normalized.includes('oauth') || normalized.includes('provider')) return 'provider_error';
    if (normalized.includes('credential') || normalized.includes('password')) return 'invalid_credentials';
    if (normalized.includes('token') || normalized.includes('session')) return 'session_expired';
    return 'unknown';
}

function mapErrorCode(rawCode: string | undefined, message: string): AuthErrorCode {
    switch (rawCode) {
        case 'invalid_credentials': return 'invalid_credentials';
        case 'email_not_confirmed': return 'email_not_confirmed';
        case 'user_already_exists':
        case 'email_exists':
        case 'user_already_registered': return 'user_already_exists';
        case 'weak_password': return 'weak_password';
        case 'rate_limited':
        case 'over_request_rate_limit':
        case 'rate_limit_exceeded':
        case 'too_many_requests': return 'rate_limited';
        case 'network_error':
        case 'network_request_failed':
        case 'fetch_failed': return 'network_error';
        case 'provider_error':
        case 'oauth_error': return 'provider_error';
        case 'session_expired':
        case 'token_refresh_failed':
        case 'invalid_token':
        case 'expired_token': return 'session_expired';
        default: return isKnownErrorCode(rawCode) ? rawCode : inferCodeFromMessage(message);
    }
}

function readMessage(error: unknown, record: Record<string, unknown> | undefined): string {
    if (error instanceof Error && error.message.length > 0) return error.message;
    if (typeof error === 'string' && error.length > 0) return error;
    return readString(record ?? {}, 'message')
        ?? readString(record ?? {}, 'error_description')
        ?? readString(record ?? {}, 'error')
        ?? 'Authentication failed';
}

/** Convert a provider failure into a stable error without retaining provider secrets. */
export function normalizeAuthError(error: unknown, provider?: OAuthProvider): AuthError {
    const record = isRecord(error) ? error : undefined;
    const message = readMessage(error, record);
    const code = mapErrorCode(record ? readString(record, 'code') : undefined, message);
    const status = readStatus(record);
    const normalizedProvider = provider ?? (record ? readString(record, 'provider') : undefined);
    const rawRetryable = record?.['retryable'];
    const retryable = typeof rawRetryable === 'boolean'
        ? rawRetryable
        : code === 'network_error' || code === 'rate_limited';
    return {
        code,
        message,
        ...(status === undefined ? {} : { status }),
        ...(normalizedProvider === undefined ? {} : { provider: normalizedProvider }),
        retryable,
    };
}

export function isAuthError(value: unknown): value is AuthError {
    if (!isRecord(value)) return false;
    return isKnownErrorCode(value['code']) && typeof value['message'] === 'string';
}

/** A local-only guest session, intentionally separate from provider AuthClient. */
export interface GuestSession {
    readonly user: AuthUser;
    readonly sessionId: string;
    readonly expiresAt: number;
}

export type GuestSessionResult =
    | { readonly data: GuestSession | null; readonly error: null }
    | { readonly data: null; readonly error: AuthError };

export type GuestSignOutResult =
    | { readonly data: null; readonly error: null }
    | { readonly data: null; readonly error: AuthError };

export interface GuestSessionClient {
    signInAsGuest(): Promise<GuestSessionResult>;
    getSession(): Promise<GuestSessionResult>;
    signOut(): Promise<GuestSignOutResult>;
}


export interface AuthViewModelOptions {
    readonly guestClient?: GuestSessionClient;
    readonly now?: () => number;
}

export type AuthStateObserver = (state: AuthState, guestSession: GuestSession | null) => void;

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
export class AuthViewModel {
    private state: AuthState = { status: 'loading' };
    private guest: GuestSession | null = null;
    private readonly observers = new Set<AuthStateObserver>();
    private readonly clientUnsubscribe: AuthUnsubscribe;
    private requestId = 0;
    private disposed = false;

    private readonly guestClient: GuestSessionClient | undefined;
    private readonly now: () => number;

    public constructor(
        private readonly client: AuthClient,
        options: AuthViewModelOptions = {},
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
        const requestId = ++this.requestId;
        this.update({ status: 'loading' });
        const result = await this.client.getSession();
        if (this.disposed || requestId !== this.requestId) return this.state;
        if (result.error !== null) return this.update({ status: 'error', error: result.error });
        return result.data.session === null
            ? this.update({ status: 'anonymous' })
            : this.update({ status: 'authenticated', session: result.data.session });
    }

    public async signIn(credentials: AuthSignInCredentials): Promise<AuthState> {
        const requestId = ++this.requestId;
        this.update({ status: 'loading' });
        const result = await this.client.signIn(credentials);
        if (this.disposed || requestId !== this.requestId) return this.state;
        if (result.error !== null) return this.update({ status: 'error', error: result.error });
        this.guest = null;
        return this.update({ status: 'authenticated', session: result.data.session });
    }

    public async signUp(credentials: AuthSignUpCredentials): Promise<AuthState> {
        const requestId = ++this.requestId;
        this.update({ status: 'loading' });
        const result = await this.client.signUp(credentials);
        if (this.disposed || requestId !== this.requestId) return this.state;
        if (result.error !== null) return this.update({ status: 'error', error: result.error });
        return result.data.session === null
            ? this.update({ status: 'anonymous' })
            : this.update({ status: 'authenticated', session: result.data.session });
    }

    public async signInWithOAuth(credentials: AuthOAuthCredentials): Promise<AuthState> {
        const requestId = ++this.requestId;
        this.update({ status: 'loading' });
        const result = await this.client.signInWithOAuth(credentials);
        if (this.disposed || requestId !== this.requestId) return this.state;
        return result.error === null ? this.getState() : this.update({ status: 'error', error: result.error });
    }

    public async signInAsGuest(): Promise<AuthState> {
        const requestId = ++this.requestId;
        if (this.guestClient === undefined) {
            return this.update({ status: 'error', error: guestUnavailableError() });
        }
        const result = await this.guestClient.signInAsGuest();
        if (this.disposed || requestId !== this.requestId) return this.state;
        if (result.error !== null) return this.update({ status: 'error', error: result.error });
        if (result.data === null) return this.update({ status: 'error', error: guestUnavailableError() });
        this.guest = result.data;
        return this.state.status === 'authenticated' ? this.getState() : this.update({ status: 'anonymous' });
    }

    public async signOut(): Promise<AuthState> {
        const requestId = ++this.requestId;
        this.update({ status: 'loading' });
        const guestResult = this.guestClient === undefined || this.guest === null
            ? { data: null, error: null }
            : await this.guestClient.signOut();
        const authResult = await this.client.signOut();
        if (this.disposed || requestId !== this.requestId) return this.state;
        if (guestResult.error !== null) return this.update({ status: 'error', error: guestResult.error });
        if (authResult.error !== null) return this.update({ status: 'error', error: authResult.error });
        this.guest = null;
        return this.update({ status: 'anonymous' });
    }

    public async refreshSession(): Promise<AuthState> {
        const requestId = ++this.requestId;
        this.update({ status: 'loading' });
        const result = await this.client.refreshSession();
        if (this.disposed || requestId !== this.requestId) return this.state;
        if (result.error !== null) return this.update({ status: 'error', error: result.error });
        return result.data.session === null
            ? this.update({ status: 'anonymous' })
            : this.update({ status: 'authenticated', session: result.data.session });
    }

    public resetError(): AuthState {
        if (this.state.status === 'error') return this.update({ status: 'anonymous' });
        return this.state;
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
        this.requestId++;
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
        for (const observer of [...this.observers]) observer(next, this.guest);
        return next;
    }
}
