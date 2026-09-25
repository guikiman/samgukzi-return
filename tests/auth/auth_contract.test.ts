import { describe, expect, it, vi } from 'vitest';
import {
    AUTH_ERROR_CODES,
    DEFAULT_AUTH_CLIENT_CONFIG,
    createGuestSession,
    createMockAuthClient,
    createMockGuestSessionClient,
    createTestSession,
    createTestUser,
    isAuthError,
    normalizeAuthError,
    OAUTH_PROVIDERS,
    TEST_AUTH_SESSION,
} from '../support/auth/index.js';
import type {
    AuthError,
    AuthState,
    AuthSignInResult,
} from '../support/auth/index.js';

function errorResult(error: AuthError): AuthSignInResult {
    return { data: null, error };
}

describe('auth contract mirror', () => {
    it('models loading, authenticated, anonymous, and error states without token fields', () => {
        const states: readonly AuthState[] = [
            { status: 'loading' },
            { status: 'authenticated', session: TEST_AUTH_SESSION },
            { status: 'anonymous' },
            { status: 'error', error: normalizeAuthError(new Error('request failed')) },
        ];

        expect(states.map((state) => state.status)).toEqual(['loading', 'authenticated', 'anonymous', 'error']);
        expect(Object.keys(TEST_AUTH_SESSION)).not.toContain('accessToken');
        expect(Object.keys(TEST_AUTH_SESSION)).not.toContain('refreshToken');
        expect(DEFAULT_AUTH_CLIENT_CONFIG).toEqual({
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
        });
    });

    it('normalizes provider aliases while dropping unknown secret-like fields', () => {
        const cases: readonly { readonly raw: unknown; readonly code: string; readonly retryable: boolean }[] = [
            { raw: { code: 'invalid_credentials', message: 'invalid credentials' }, code: 'invalid_credentials', retryable: false },
            { raw: { code: 'email_not_confirmed', message: 'email not confirmed' }, code: 'email_not_confirmed', retryable: false },
            { raw: { code: 'weak_password', message: 'weak password' }, code: 'weak_password', retryable: false },
            { raw: { code: 'over_request_rate_limit', message: 'Too many requests', status: 429 }, code: 'rate_limited', retryable: true },
            { raw: { code: 'oauth_error', message: 'provider rejected', provider: 'github', accessToken: 'must-not-leak' }, code: 'provider_error', retryable: false },
            { raw: { code: 'expired_token', message: 'expired token', refreshToken: 'must-not-leak' }, code: 'session_expired', retryable: false },
            { raw: new Error('Failed to fetch'), code: 'network_error', retryable: true },
            { raw: { message: 'unmapped response' }, code: 'unknown', retryable: false },
        ];

        for (const testCase of cases) {
            const normalized = normalizeAuthError(testCase.raw);
            expect(normalized.code).toBe(testCase.code);
            expect(normalized.retryable).toBe(testCase.retryable);
            expect(Object.keys(normalized)).not.toContain('accessToken');
            expect(Object.keys(normalized)).not.toContain('refreshToken');
        }
        expect(AUTH_ERROR_CODES).toContain('unknown');
        const providerError = normalizeAuthError({ code: 'oauth_error', message: 'rejected' }, 'google');
        expect(providerError.provider).toBe('google');
        expect(providerError.status).toBeUndefined();
        expect(isAuthError(normalizeAuthError({ code: 'unknown', message: 'safe' }))).toBe(true);
        expect(isAuthError({ code: 'not-a-code', message: 'unsafe' })).toBe(false);
        expect(OAUTH_PROVIDERS).toContain('google');
    });

    it('records only safe request metadata in the mock client', async () => {
        const client = createMockAuthClient();
        const credentials = {
            email: 'player@example.test',
            password: 'test-password-placeholder',
            options: { captchaToken: 'captcha-placeholder' },
        } as const;

        await client.signIn(credentials);
        await client.signUp(credentials);
        await client.signInWithOAuth({
            provider: 'github',
            options: { scopes: 'read:user', queryParams: { prompt: 'consent' } },
        });

        const calls = client.getCalls();
        expect(calls.signIn[0]).toEqual({
            email: 'player@example.test',
            hasPassword: true,
            captchaTokenPresent: true,
            optionKeys: ['captchaToken'],
        });
        expect(calls.signUp[0]).toEqual(calls.signIn[0]);
        expect(calls.oauth[0]).toEqual({ provider: 'github', optionKeys: ['queryParams', 'scopes'] });
        expect(JSON.stringify(calls)).not.toContain('test-password-placeholder');
        expect(JSON.stringify(calls)).not.toContain('captcha-placeholder');
    });

    it('returns deterministic sign-up, OAuth, refresh, and logout results', async () => {
        const session = createTestSession({ sessionId: 'session-refreshed', expiresAt: 1_900_003_600 });
        const client = createMockAuthClient({
            signUpResult: { data: { user: createTestUser(), session: null }, error: null },
            oauthResult: { data: { provider: 'kakao', url: 'https://auth.example.test/kakao', flowId: 'flow-1' }, error: null },
            refreshResult: { data: { session }, error: null },
        });

        const signUp = await client.signUp({ email: 'new@example.test', password: 'password-placeholder' });
        const oauth = await client.signInWithOAuth({ provider: 'kakao' });
        const refreshed = await client.refreshSession();
        const signedOut = await client.signOut({ scope: 'local' });

        expect(signUp).toEqual({ data: { user: expect.objectContaining({ email: 'player@example.test' }), session: null }, error: null });
        expect(oauth).toEqual({ data: { provider: 'kakao', url: 'https://auth.example.test/kakao', flowId: 'flow-1' }, error: null });
        expect(refreshed).toEqual({ data: { session }, error: null });
        expect(signedOut).toEqual({ data: null, error: null });
        expect(client.getCalls().signOut).toEqual([{ scope: 'local' }]);
    });

    it('delivers events once and makes unsubscribe idempotent', () => {
        const client = createMockAuthClient({ initialSession: TEST_AUTH_SESSION });
        const events: string[] = [];
        const unsubscribe = client.onAuthStateChange((event) => events.push(event));

        client.emit('INITIAL_SESSION', TEST_AUTH_SESSION);
        client.emit('SIGNED_OUT', null);
        unsubscribe();
        unsubscribe();
        client.emit('SIGNED_IN', TEST_AUTH_SESSION);

        expect(events).toEqual(['INITIAL_SESSION', 'SIGNED_OUT']);
        expect(client.listenerCount).toBe(0);
    });

    it('cleans listeners and prevents post-dispose state leakage', () => {
        const client = createMockAuthClient({ initialSession: TEST_AUTH_SESSION });
        const listener = vi.fn();
        client.onAuthStateChange(listener);
        client.signIn({ email: 'player@example.test', password: 'password-placeholder' });
        client.dispose();
        client.emit('SIGNED_OUT', null);

        expect(client.listenerCount).toBe(0);
        expect(client.getCalls().signIn).toEqual([]);
        expect(client.session).toBeNull();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(client.isDisposed).toBe(true);
        expect(client.onAuthStateChange(() => undefined)).toEqual(expect.any(Function));
    });

    it('keeps local guest sessions outside the provider AuthClient contract', async () => {
        const providerClient = createMockAuthClient();
        const guest = createGuestSession({ sessionId: 'guest-fixture' });
        const guestClient = createMockGuestSessionClient({ signInResult: { data: guest, error: null } });

        const result = await guestClient.signInAsGuest();

        expect(result).toEqual({ data: guest, error: null });
        expect(guestClient.getCalls().signInAsGuest).toBe(1);
        expect(providerClient.getCalls().signIn).toEqual([]);
        expect(guest.user).not.toHaveProperty('provider');
    });

    it('preserves the AuthSession error result shape for provider failures', () => {
        const error = normalizeAuthError({ code: 'email_exists', message: 'already registered', status: 409 });
        const result: AuthSignInResult = errorResult(error);

        expect(result.error).toMatchObject({ code: 'user_already_exists', status: 409 });
        expect(result.data).toBeNull();
    });
});
