/**
 * Test-local mirror of the provider-neutral authentication contract.
 *
 * This file intentionally has no dependency on production auth code. The
 * provider adapter can land independently; contract tests can still exercise
 * the same public shapes and safe error semantics before integration.
 */

export const OAUTH_PROVIDERS = [
    'apple', 'azure', 'bitbucket', 'discord', 'facebook', 'figma', 'github',
    'gitlab', 'google', 'kakao', 'keycloak', 'linkedin', 'linkedin_oidc',
    'notion', 'slack', 'slack_oidc', 'spotify', 'twitch', 'twitter', 'x',
    'workos', 'zoom', 'fly',
] as const;

export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number] | `custom:${string}`;
export type AuthMetadata = Readonly<Record<string, unknown>>;

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
    readonly autoRefreshToken?: boolean;
    readonly persistSession?: boolean;
    readonly detectSessionInUrl?: boolean;
    readonly storageKey?: string;
    readonly flowType?: 'implicit' | 'pkce';
}

export interface AuthConfig {
    readonly url: string;
    readonly anonKey: string;
    readonly auth?: AuthClientConfig;
}

export const DEFAULT_AUTH_CLIENT_CONFIG = {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
} as const;

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
    | {
        readonly data: {
            readonly provider: OAuthProvider;
            readonly url: string;
            readonly flowId?: string | null;
        };
        readonly error: null;
    }
    | {
        readonly data: {
            readonly provider: OAuthProvider;
            readonly url: null;
            readonly flowId?: string | null;
        };
        readonly error: AuthError;
    };

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
export type AuthStateListener = (event: AuthChangeEvent, session: AuthSession | null) => void;

export interface AuthClient {
    signUp(credentials: AuthSignUpCredentials): Promise<AuthSignUpResult>;
    signIn(credentials: AuthSignInCredentials): Promise<AuthSignInResult>;
    signInWithOAuth(credentials: AuthOAuthCredentials): Promise<AuthOAuthResult>;
    getSession(): Promise<AuthSessionResult>;
    onAuthStateChange(listener: AuthStateListener): AuthUnsubscribe;
    signOut(options?: AuthSignOutOptions): Promise<AuthSignOutResult>;
    refreshSession(): Promise<AuthSessionResult>;
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
