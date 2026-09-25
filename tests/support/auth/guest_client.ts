import type {
    GuestSession,
    GuestSessionClient,
    GuestSessionResult,
    GuestSignOutResult,
} from './contracts.js';

export const TEST_GUEST_SESSION: GuestSession = {
    user: {
        id: 'guest-local-1',
        displayName: 'Guest Player',
    },
    sessionId: 'guest-session-1',
    expiresAt: 1_900_003_600,
};

export function createGuestSession(overrides: Partial<GuestSession> = {}): GuestSession {
    return {
        ...overrides,
        user: overrides.user ?? {
            id: TEST_GUEST_SESSION.user.id,
            displayName: TEST_GUEST_SESSION.user.displayName,
        },
        sessionId: overrides.sessionId ?? TEST_GUEST_SESSION.sessionId,
        expiresAt: overrides.expiresAt ?? TEST_GUEST_SESSION.expiresAt,
    };
}

export interface GuestClientCalls {
    readonly signInAsGuest: number;
    readonly getSession: number;
    readonly signOut: number;
}

export interface MockGuestSessionClientOptions {
    readonly initialSession?: GuestSession | null;
    readonly signInResult?: GuestSessionResult;
    readonly signOutResult?: GuestSignOutResult;
}

/** Separate local guest-session fake; it has no provider-account semantics. */
export class MockGuestSessionClient implements GuestSessionClient {
    private currentSession: GuestSession | null;
    private readonly signInResult: GuestSessionResult | undefined;
    private readonly signOutResult: GuestSignOutResult | undefined;
    private readonly calls: { signInAsGuest: number; getSession: number; signOut: number } = {
        signInAsGuest: 0,
        getSession: 0,
        signOut: 0,
    };

    public constructor(options: MockGuestSessionClientOptions = {}) {
        this.currentSession = options.initialSession ?? null;
        this.signInResult = options.signInResult;
        this.signOutResult = options.signOutResult;
    }

    public get session(): GuestSession | null {
        return this.currentSession;
    }

    public getCalls(): GuestClientCalls {
        return { ...this.calls };
    }

    public async signInAsGuest(): Promise<GuestSessionResult> {
        this.calls.signInAsGuest += 1;
        const result = this.signInResult ?? { data: createGuestSession(), error: null };
        if (result.error === null && result.data !== null) this.currentSession = result.data;
        return result;
    }

    public async getSession(): Promise<GuestSessionResult> {
        this.calls.getSession += 1;
        return { data: this.currentSession, error: null };
    }

    public async signOut(): Promise<GuestSignOutResult> {
        this.calls.signOut += 1;
        const result = this.signOutResult ?? { data: null, error: null };
        if (result.error === null) this.currentSession = null;
        return result;
    }

    public dispose(): void {
        this.currentSession = null;
        this.calls.signInAsGuest = 0;
        this.calls.getSession = 0;
        this.calls.signOut = 0;
    }
}

export function createMockGuestSessionClient(options: MockGuestSessionClientOptions = {}): MockGuestSessionClient {
    return new MockGuestSessionClient(options);
}
