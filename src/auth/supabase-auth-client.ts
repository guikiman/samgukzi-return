import {
    createClient,
    type AuthChangeEvent as SupabaseAuthChangeEvent,
    type Session as SupabaseSession,
    type SupabaseClient,
    type User as SupabaseUser,
} from '@supabase/supabase-js';

import {
    DEFAULT_AUTH_CLIENT_CONFIG,
    normalizeAuthError,
    type AuthChangeEvent,
    type AuthClient,
    type AuthConfig,
    type AuthOAuthCredentials,
    type AuthOAuthResult,
    type AuthSession,
    type AuthSessionResult,
    type AuthSignInCredentials,
    type AuthSignInResult,
    type AuthSignOutOptions,
    type AuthSignOutResult,
    type AuthSignUpCredentials,
    type AuthSignUpResult,
    type AuthStateListener,
    type AuthUnsubscribe,
    type AuthUser,
} from './contracts.js';

const defaultEnv = (import.meta as ImportMeta & {
    readonly env?: Readonly<Record<string, string | undefined>>;
}).env ?? {};

/** Reads only the public Vite variables; privileged keys are rejected. */
export function readSupabaseAuthConfig(
    env: Readonly<Record<string, string | undefined>> = defaultEnv,
): AuthConfig {
    const url = env.VITE_SUPABASE_URL?.trim() ?? '';
    const anonKey = env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
    if (!url || !anonKey) throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required');
    if (/service[_-]?role/i.test(anonKey)) throw new Error('VITE_SUPABASE_ANON_KEY must be the public anon key');
    return { url, anonKey };
}

function mapChangeEvent(event: SupabaseAuthChangeEvent): AuthChangeEvent | null {
    switch (event) {
        case 'INITIAL_SESSION': return 'INITIAL_SESSION';
        case 'PASSWORD_RECOVERY': return 'PASSWORD_RECOVERY';
        case 'SIGNED_IN': return 'SIGNED_IN';
        case 'SIGNED_OUT': return 'SIGNED_OUT';
        case 'TOKEN_REFRESHED': return 'TOKEN_REFRESHED';
        case 'USER_UPDATED': return 'USER_UPDATED';
        case 'MFA_CHALLENGE_VERIFIED': return 'MFA_CHALLENGE_VERIFIED';
        default: return null;
    }
}

export function normalizeSupabaseUser(raw: SupabaseUser | null | undefined): AuthUser | null {
    if (!raw) return null;
    const metadata = raw.user_metadata as Readonly<Record<string, unknown>>;
    const appMetadata = raw.app_metadata as Readonly<Record<string, unknown>>;
    const name = metadata['display_name'] ?? metadata['full_name'] ?? metadata['name'];
    const avatar = metadata['avatar_url'];
    const provider = appMetadata['provider'];
    return {
        id: raw.id,
        ...(raw.email == null ? {} : { email: raw.email }),
        ...(raw.phone == null ? {} : { phone: raw.phone }),
        ...(raw.email_confirmed_at == null ? {} : { emailVerified: true }),
        ...(typeof name === 'string' ? { displayName: name } : {}),
        ...(typeof avatar === 'string' ? { avatarUrl: avatar } : {}),
        ...(typeof provider === 'string' ? { provider } : {}),
        ...(raw.is_anonymous == null ? {} : { isAnonymous: raw.is_anonymous }),
        ...(raw.created_at == null ? {} : { createdAt: raw.created_at }),
        ...(raw.last_sign_in_at == null ? {} : { lastSignInAt: raw.last_sign_in_at }),
        metadata,
        appMetadata,
    };
}

export function normalizeSupabaseSession(raw: SupabaseSession | null | undefined): AuthSession | null {
    if (!raw) return null;
    const user = normalizeSupabaseUser(raw.user);
    if (!user) return null;
    return {
        user,
        expiresAt: raw.expires_at ?? Math.floor(Date.now() / 1000) + raw.expires_in,
        ...(user.provider === undefined ? {} : { provider: user.provider }),
    };
}

export class SupabaseAuthClient implements AuthClient {
    public constructor(
        private readonly client: SupabaseClient,
    ) {}

    public static fromEnv(env?: Readonly<Record<string, string | undefined>>): SupabaseAuthClient {
        const config = readSupabaseAuthConfig(env);
        return createSupabaseAuthClient(config);
    }

    public getSupabaseClient(): SupabaseClient { return this.client; }

    public async signUp(credentials: AuthSignUpCredentials): Promise<AuthSignUpResult> {
        const { data, error } = await this.client.auth.signUp({
            email: credentials.email,
            password: credentials.password,
            options: {
                ...(credentials.options?.emailRedirectTo === undefined ? {} : { emailRedirectTo: credentials.options.emailRedirectTo }),
                ...(credentials.options?.data === undefined ? {} : { data: credentials.options.data }),
                ...(credentials.options?.captchaToken === undefined ? {} : { captchaToken: credentials.options.captchaToken }),
            },
        });
        if (error !== null) return { data: null, error: normalizeAuthError(error) };
        return {
            data: {
                user: normalizeSupabaseUser(data.user),
                session: normalizeSupabaseSession(data.session),
            },
            error: null,
        };
    }

    public async signIn(credentials: AuthSignInCredentials): Promise<AuthSignInResult> {
        const { data, error } = await this.client.auth.signInWithPassword({
            email: credentials.email,
            password: credentials.password,
            options: credentials.options?.captchaToken === undefined
                ? undefined
                : { captchaToken: credentials.options.captchaToken },
        });
        if (error !== null) return { data: null, error: normalizeAuthError(error) };
        const user = normalizeSupabaseUser(data.user);
        const session = normalizeSupabaseSession(data.session);
        if (!user || !session) {
            return { data: null, error: normalizeAuthError('Sign in returned no session') };
        }
        return { data: { user, session }, error: null };
    }

    public async signInWithOAuth(credentials: AuthOAuthCredentials): Promise<AuthOAuthResult> {
        const provider = credentials.provider.replace(/^custom:/, '');
        const { data, error } = await this.client.auth.signInWithOAuth({
            provider: provider as Parameters<typeof this.client.auth.signInWithOAuth>[0]['provider'],
            options: {
                ...(credentials.options?.redirectTo === undefined ? {} : { redirectTo: credentials.options.redirectTo }),
                ...(credentials.options?.scopes === undefined ? {} : { scopes: credentials.options.scopes }),
                ...(credentials.options?.queryParams === undefined ? {} : { queryParams: credentials.options.queryParams }),
                ...(credentials.options?.skipBrowserRedirect === undefined ? {} : { skipBrowserRedirect: credentials.options.skipBrowserRedirect }),
            },
        });
        if (error !== null) {
            return {
                data: { provider: credentials.provider, url: null, flowId: data.flowId },
                error: normalizeAuthError(error, credentials.provider),
            };
        }
        return {
            data: { provider: credentials.provider, url: data.url, flowId: data.flowId },
            error: null,
        };
    }

    public async getSession(): Promise<AuthSessionResult> {
        const { data, error } = await this.client.auth.getSession();
        if (error !== null) return { data: null, error: normalizeAuthError(error) };
        return { data: { session: normalizeSupabaseSession(data.session) }, error: null };
    }

    public onAuthStateChange(listener: AuthStateListener): AuthUnsubscribe {
        const { data: { subscription } } = this.client.auth.onAuthStateChange((event, session) => {
            const mapped = mapChangeEvent(event);
            if (mapped !== null) listener(mapped, normalizeSupabaseSession(session));
        });
        let active = true;
        return () => {
            if (!active) return;
            active = false;
            subscription.unsubscribe();
        };
    }

    public async signOut(options?: AuthSignOutOptions): Promise<AuthSignOutResult> {
        const { error } = await this.client.auth.signOut(options?.scope === undefined
            ? undefined
            : { scope: options.scope });
        return error === null
            ? { data: null, error: null }
            : { data: null, error: normalizeAuthError(error) };
    }

    public async refreshSession(): Promise<AuthSessionResult> {
        const { data, error } = await this.client.auth.refreshSession();
        if (error !== null) return { data: null, error: normalizeAuthError(error) };
        return { data: { session: normalizeSupabaseSession(data.session) }, error: null };
    }
}

export function createSupabaseAuthClient(
    config: AuthConfig,
    client?: SupabaseClient,
): SupabaseAuthClient {
    const supabase = client ?? createClient(config.url, config.anonKey, {
        auth: {
            autoRefreshToken: config.auth?.autoRefreshToken ?? DEFAULT_AUTH_CLIENT_CONFIG.autoRefreshToken,
            persistSession: config.auth?.persistSession ?? DEFAULT_AUTH_CLIENT_CONFIG.persistSession,
            detectSessionInUrl: config.auth?.detectSessionInUrl ?? DEFAULT_AUTH_CLIENT_CONFIG.detectSessionInUrl,
            ...(config.auth?.storageKey === undefined ? {} : { storageKey: config.auth.storageKey }),
            ...(config.auth?.flowType === undefined ? {} : { flowType: config.auth.flowType }),
        },
    });
    return new SupabaseAuthClient(supabase);
}
