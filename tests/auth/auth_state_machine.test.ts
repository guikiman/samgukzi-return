import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    createGuestSession,
    createMockAuthClient,
    createMockGuestSessionClient,
    createTestSession,
    createTestUser,
    normalizeAuthError,
    TEST_AUTH_NOW_SECONDS,
    TEST_AUTH_SESSION,
} from '../support/auth/index.js';
import type {
    MockAuthClient,
    MockAuthClientOptions,
    MockGuestSessionClient,
    MockGuestSessionClientOptions,
} from '../support/auth/index.js';
import { AuthStateMachine } from '../support/auth/index.js';

interface Harness {
    readonly client: MockAuthClient;
    readonly guest: MockGuestSessionClient;
    readonly machine: AuthStateMachine;
}

const cleanups: (() => void)[] = [];

function setup(
    authOptions: MockAuthClientOptions = {},
    guestOptions: MockGuestSessionClientOptions = {},
): Harness {
    const client = createMockAuthClient(authOptions);
    const guest = createMockGuestSessionClient(guestOptions);
    const machine = new AuthStateMachine(client, { guestClient: guest, now: () => TEST_AUTH_NOW_SECONDS });
    cleanups.push(() => {
        machine.dispose();
        client.dispose();
        guest.dispose();
    });
    return { client, guest, machine };
}

function errorResult(code: string, message: string) {
    return { data: null, error: normalizeAuthError({ code, message }) };
}

describe('auth state machine', () => {
    beforeEach(() => {
        cleanups.length = 0;
    });

    afterEach(() => {
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    });

    it('starts loading and becomes authenticated when a session is restored', async () => {
        const { machine } = setup({ initialSession: TEST_AUTH_SESSION });

        expect(machine.getState()).toEqual({ status: 'loading' });
        const state = await machine.initialize();

        expect(state).toEqual({ status: 'authenticated', session: TEST_AUTH_SESSION });
    });

    it('becomes anonymous when no session is restored', async () => {
        const { machine } = setup();

        expect(await machine.initialize()).toEqual({ status: 'anonymous' });
    });

    it('becomes an error state when session restoration fails', async () => {
        const error = normalizeAuthError({ code: 'network_error', message: 'offline' });
        const { machine } = setup({ sessionResult: { data: null, error } });

        const state = await machine.initialize();

        expect(state).toEqual({ status: 'error', error });
    });

    it('transitions from loading to authenticated on sign-in success', async () => {
        const session = createTestSession({ sessionId: 'session-sign-in' });
        const { client, machine } = setup({
            signInResult: { data: { user: session.user, session }, error: null },
        });

        const state = await machine.signIn({ email: 'player@example.test', password: 'password-placeholder' });

        expect(state).toEqual({ status: 'authenticated', session });
        expect(client.getCalls().signIn[0]?.email).toBe('player@example.test');
    });

    it('normalizes sign-in failures into the error AuthState', async () => {
        const { machine } = setup({ signInResult: errorResult('invalid_credentials', 'bad password') });

        const state = await machine.signIn({ email: 'player@example.test', password: 'wrong-placeholder' });

        expect(state.status).toBe('error');
        if (state.status !== 'error') throw new Error('Expected error state');
        expect(state.error.code).toBe('invalid_credentials');
        expect(state.error.retryable).toBe(false);
    });

    it('transitions sign-up with a session to authenticated', async () => {
        const session = createTestSession({ sessionId: 'session-sign-up' });
        const { machine } = setup({
            signUpResult: { data: { user: session.user, session }, error: null },
        });

        const state = await machine.signUp({ email: 'new@example.test', password: 'password-placeholder' });

        expect(state).toEqual({ status: 'authenticated', session });
    });

    it('keeps a sign-up without a session anonymous pending confirmation', async () => {
        const { machine } = setup({
            signUpResult: { data: { user: createTestUser({ email: 'pending@example.test' }), session: null }, error: null },
        });

        expect(await machine.signUp({ email: 'pending@example.test', password: 'password-placeholder' })).toEqual({ status: 'anonymous' });
    });

    it('waits for an OAuth callback and then accepts the authenticated event', async () => {
        const { client, machine } = setup();

        const waiting = await machine.signInWithOAuth({ provider: 'github' });
        expect(waiting).toEqual({ status: 'loading' });

        client.emit('SIGNED_IN', TEST_AUTH_SESSION);
        expect(machine.getState()).toEqual({ status: 'authenticated', session: TEST_AUTH_SESSION });
    });

    it('returns anonymous after a successful logout', async () => {
        const { client, machine } = setup({ initialSession: TEST_AUTH_SESSION });
        await machine.initialize();

        const state = await machine.signOut();

        expect(state).toEqual({ status: 'anonymous' });
        expect(client.session).toBeNull();
        expect(client.getCalls().signOut).toEqual([undefined]);
    });

    it('stores a local guest session without changing AuthState to authenticated', async () => {
        const guestSession = createGuestSession({ sessionId: 'guest-state-test' });
        const { client, machine } = setup({}, { signInResult: { data: guestSession, error: null } });

        const state = await machine.signInAsGuest();

        expect(state).toEqual({ status: 'anonymous' });
        expect(machine.getGuestSession()).toEqual(guestSession);
        expect(client.getCalls().signIn).toEqual([]);
    });

    it('clears a local guest session on logout', async () => {
        const guestSession = createGuestSession({ sessionId: 'guest-logout-test' });
        const { machine } = setup({}, { signInResult: { data: guestSession, error: null } });
        await machine.signInAsGuest();

        expect(await machine.signOut()).toEqual({ status: 'anonymous' });
        expect(machine.getGuestSession()).toBeNull();
    });

    it('refreshes an authenticated session with a deterministic replacement', async () => {
        const refreshed = createTestSession({ sessionId: 'session-refreshed', expiresAt: TEST_AUTH_NOW_SECONDS + 7_200 });
        const { client, machine } = setup({
            initialSession: TEST_AUTH_SESSION,
            refreshResult: { data: { session: refreshed }, error: null },
        });
        await machine.initialize();

        const state = await machine.refreshSession();

        expect(state).toEqual({ status: 'authenticated', session: refreshed });
        expect(client.getCalls().refreshSession).toBe(1);
    });

    it('moves to anonymous when refresh confirms there is no session', async () => {
        const { machine } = setup({
            initialSession: TEST_AUTH_SESSION,
            refreshResult: { data: { session: null }, error: null },
        });
        await machine.initialize();

        expect(await machine.refreshSession()).toEqual({ status: 'anonymous' });
    });

    it('moves to error when refresh fails with a normalized provider error', async () => {
        const { machine } = setup({
            initialSession: TEST_AUTH_SESSION,
            refreshResult: errorResult('token_refresh_failed', 'refresh token expired'),
        });
        await machine.initialize();

        const state = await machine.refreshSession();

        expect(state.status).toBe('error');
        if (state.status !== 'error') throw new Error('Expected error state');
        expect(state.error.code).toBe('session_expired');
    });

    it('marks an authenticated session expired at the expiry boundary', async () => {
        const session = createTestSession({ expiresAt: TEST_AUTH_NOW_SECONDS + 10 });
        const { machine } = setup({ initialSession: session });
        await machine.initialize();

        expect(machine.checkSessionExpiry(TEST_AUTH_NOW_SECONDS + 9).status).toBe('authenticated');
        expect(machine.checkSessionExpiry(TEST_AUTH_NOW_SECONDS + 10)).toEqual({
            status: 'error',
            error: { code: 'session_expired', message: 'The session has expired', retryable: false },
        });
    });

    it('clears an expired local guest session while remaining anonymous', async () => {
        const guestSession = createGuestSession({ expiresAt: TEST_AUTH_NOW_SECONDS + 5 });
        const { machine } = setup({}, { signInResult: { data: guestSession, error: null } });
        await machine.initialize();
        await machine.signInAsGuest();

        const state = machine.checkSessionExpiry(TEST_AUTH_NOW_SECONDS + 5);

        expect(state).toEqual({ status: 'anonymous' });
        expect(machine.getGuestSession()).toBeNull();
    });

    it('removes state observers idempotently and unsubscribes from the client', () => {
        const { client, machine } = setup();
        const observed: string[] = [];
        const unsubscribe = machine.onStateChange((state) => observed.push(state.status));

        client.emit('SIGNED_IN', TEST_AUTH_SESSION);
        unsubscribe();
        unsubscribe();
        client.emit('SIGNED_OUT', null);

        expect(observed).toEqual(['authenticated']);
        expect(machine.listenerCount).toBe(0);
        expect(client.listenerCount).toBe(1);
    });
});
