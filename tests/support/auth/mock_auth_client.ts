import type {
    AuthChangeEvent,
    AuthClient,
    AuthOAuthCredentials,
    AuthOAuthResult,
    AuthSession,
    AuthSessionResult,
    AuthSignInCredentials,
    AuthSignInResult,
    AuthSignOutOptions,
    AuthSignOutResult,
    AuthSignUpCredentials,
    AuthSignUpResult,
    AuthStateListener,
    AuthUnsubscribe,
    AuthUser,
    OAuthProvider,
} from './contracts.js';

export const TEST_AUTH_NOW_SECONDS = 1_900_000_000;
export const TEST_AUTH_EXPIRES_AT_SECONDS = TEST_AUTH_NOW_SECONDS + 3_600;
export const TEST_AUTH_USER = {
    id: 'user-test-1',
    email: 'player@example.test',
    emailVerified: true,
    displayName: 'Test Player',
    provider: 'email',
} as const;
export const TEST_AUTH_SESSION: AuthSession = {
    user: TEST_AUTH_USER,
    expiresAt: TEST_AUTH_EXPIRES_AT_SECONDS,
    provider: 'email',
    sessionId: 'session-test-1',
};
export function createTestUser(overrides: Partial<AuthUser> = {}): AuthUser {
    return {
        ...overrides,
        id: overrides.id ?? TEST_AUTH_USER.id,
        email: overrides.email ?? TEST_AUTH_USER.email,
        emailVerified: overrides.emailVerified ?? TEST_AUTH_USER.emailVerified,
        displayName: overrides.displayName ?? TEST_AUTH_USER.displayName,
        provider: overrides.provider ?? TEST_AUTH_USER.provider,
    };
}

export function createTestSession(
    sessionOverrides: Partial<AuthSession> = {},
    userOverrides: Partial<AuthUser> = {},
): AuthSession {
    return {
        ...sessionOverrides,
        user: sessionOverrides.user ?? createTestUser(userOverrides),
        expiresAt: sessionOverrides.expiresAt ?? TEST_AUTH_EXPIRES_AT_SECONDS,
        provider: sessionOverrides.provider ?? 'email',
        sessionId: sessionOverrides.sessionId ?? 'session-test-1',
    };
}

export interface AuthCallRecord {
    readonly email: string;
    readonly hasPassword: boolean;
    readonly captchaTokenPresent: boolean;
    readonly optionKeys: readonly string[];
}

export interface OAuthCallRecord {
    readonly provider: OAuthProvider;
    readonly optionKeys: readonly string[];
}

export interface AuthClientCalls {
    readonly signIn: readonly AuthCallRecord[];
    readonly signUp: readonly AuthCallRecord[];
    readonly oauth: readonly OAuthCallRecord[];
    readonly getSession: number;
    readonly signOut: readonly (AuthSignOutOptions | undefined)[];
    readonly refreshSession: number;
}

export interface MockAuthClientOptions {
    readonly initialSession?: AuthSession | null;
    readonly signInResult?: AuthSignInResult;
    readonly signUpResult?: AuthSignUpResult;
    readonly oauthResult?: AuthOAuthResult;
    readonly sessionResult?: AuthSessionResult;
    readonly signOutResult?: AuthSignOutResult;
    readonly refreshResult?: AuthSessionResult;
}

interface MutableAuthClientCalls {
    signIn: AuthCallRecord[];
    signUp: AuthCallRecord[];
    oauth: OAuthCallRecord[];
    getSession: number;
    signOut: (AuthSignOutOptions | undefined)[];
    refreshSession: number;
}

function emailCall(credentials: AuthSignInCredentials | AuthSignUpCredentials): AuthCallRecord {
    const options = credentials.options;
    return {
        email: credentials.email,
        hasPassword: credentials.password.length > 0,
        captchaTokenPresent: options?.captchaToken !== undefined,
        optionKeys: options === undefined ? [] : Object.keys(options).sort(),
    };
}

function oauthCall(credentials: AuthOAuthCredentials): OAuthCallRecord {
    return {
        provider: credentials.provider,
        optionKeys: credentials.options === undefined ? [] : Object.keys(credentials.options).sort(),
    };
}

function defaultSignInResult(session: AuthSession): AuthSignInResult {
    return { data: { user: session.user, session }, error: null };
}

function defaultSignUpResult(user: AuthUser): AuthSignUpResult {
    return { data: { user, session: null }, error: null };
}

function defaultOAuthResult(provider: OAuthProvider): AuthOAuthResult {
    return {
        data: {
            provider,
            url: `https://auth.example.test/oauth/${provider}`,
            flowId: null,
        },
        error: null,
    };
}

/** In-memory provider-neutral fake; it never performs I/O. */
export class MockAuthClient implements AuthClient {
    private currentSession: AuthSession | null;
    private readonly listeners = new Set<AuthStateListener>();
    private readonly calls: MutableAuthClientCalls = {
        signIn: [],
        signUp: [],
        oauth: [],
        getSession: 0,
        signOut: [],
        refreshSession: 0,
    };
    private readonly signInResult: AuthSignInResult | undefined;
    private readonly signUpResult: AuthSignUpResult | undefined;
    private readonly oauthResult: AuthOAuthResult | undefined;
    private readonly sessionResult: AuthSessionResult | undefined;
    private readonly signOutResult: AuthSignOutResult | undefined;
    private readonly refreshResult: AuthSessionResult | undefined;
    private disposed = false;

    public constructor(options: MockAuthClientOptions = {}) {
        this.currentSession = options.initialSession ?? null;
        this.signInResult = options.signInResult;
        this.signUpResult = options.signUpResult;
        this.oauthResult = options.oauthResult;
        this.sessionResult = options.sessionResult;
        this.signOutResult = options.signOutResult;
        this.refreshResult = options.refreshResult;
    }

    public get session(): AuthSession | null {
        return this.currentSession;
    }

    public get listenerCount(): number {
        return this.listeners.size;
    }

    public get isDisposed(): boolean {
        return this.disposed;
    }

    public getCalls(): AuthClientCalls {
        return {
            signIn: [...this.calls.signIn],
            signUp: [...this.calls.signUp],
            oauth: [...this.calls.oauth],
            getSession: this.calls.getSession,
            signOut: [...this.calls.signOut],
            refreshSession: this.calls.refreshSession,
        };
    }

    public async signUp(credentials: AuthSignUpCredentials): Promise<AuthSignUpResult> {
        this.calls.signUp.push(emailCall(credentials));
        const result = this.signUpResult ?? defaultSignUpResult(credentials.email === '' ? createTestUser() : createTestUser({ email: credentials.email }));
        if (result.error === null && result.data.session !== null) {
            this.currentSession = result.data.session;
            this.emit('SIGNED_IN', result.data.session);
        }
        return result;
    }

    public async signIn(credentials: AuthSignInCredentials): Promise<AuthSignInResult> {
        this.calls.signIn.push(emailCall(credentials));
        const result = this.signInResult ?? defaultSignInResult(this.currentSession ?? createTestSession({}, { email: credentials.email }));
        if (result.error === null) {
            this.currentSession = result.data.session;
            this.emit('SIGNED_IN', result.data.session);
        }
        return result;
    }

    public async signInWithOAuth(credentials: AuthOAuthCredentials): Promise<AuthOAuthResult> {
        this.calls.oauth.push(oauthCall(credentials));
        return this.oauthResult ?? defaultOAuthResult(credentials.provider);
    }

    public async getSession(): Promise<AuthSessionResult> {
        this.calls.getSession += 1;
        if (this.sessionResult !== undefined) return this.sessionResult;
        return { data: { session: this.currentSession }, error: null };
    }

    public onAuthStateChange(listener: AuthStateListener): AuthUnsubscribe {
        if (this.disposed) return () => undefined;
        this.listeners.add(listener);
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            this.listeners.delete(listener);
        };
    }

    public async signOut(options?: AuthSignOutOptions): Promise<AuthSignOutResult> {
        this.calls.signOut.push(options);
        const result = this.signOutResult ?? { data: null, error: null };
        if (result.error === null) {
            this.currentSession = null;
            this.emit('SIGNED_OUT', null);
        }
        return result;
    }

    public async refreshSession(): Promise<AuthSessionResult> {
        this.calls.refreshSession += 1;
        const result = this.refreshResult ?? { data: { session: this.currentSession }, error: null };
        if (result.error === null) {
            this.currentSession = result.data.session;
            this.emit('TOKEN_REFRESHED', this.currentSession);
        }
        return result;
    }

    public emit(event: AuthChangeEvent, session: AuthSession | null = this.currentSession): void {
        if (this.disposed) return;
        this.currentSession = session;
        for (const listener of [...this.listeners]) listener(event, session);
    }

    public setSession(session: AuthSession | null): void {
        this.currentSession = session;
    }

    public dispose(): void {
        this.listeners.clear();
        this.calls.signIn.length = 0;
        this.calls.signUp.length = 0;
        this.calls.oauth.length = 0;
        this.calls.signOut.length = 0;
        this.calls.getSession = 0;
        this.calls.refreshSession = 0;
        this.currentSession = null;
        this.disposed = true;
    }
}

export function createMockAuthClient(options: MockAuthClientOptions = {}): MockAuthClient {
    return new MockAuthClient(options);
}
