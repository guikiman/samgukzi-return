/**
 * 인증 통합 부트스트랩 (integration glue)
 *
 * 승인된 계약(`src/auth/contracts.ts`)과 백엔드/UI 모듈을 브라우저 런타임 한 곳에서
 * 조립한다. 이 파일은 소유권 경계에 있는 통합 전용 코드이며, 기능 소유 파일
 * (계약/백엔드/UI/테스트)은 수정하지 않는다.
 *
 * 설계 메모:
 * - `@supabase/supabase-js`는 브라우저에서 해석되지 않는 bare specifier다. 정적
 *   import를 쓰면 dist 모듈 그래프가 깨지므로, 공개 설정이 실제로 존재할 때만
 *   동적으로 로드한다.
 * - 공개 설정이 없으면 네트워크를 전혀 호출하지 않는 오프라인 어댑터를 사용한다.
 *   따라서 오프라인 플레이와 브라우저 E2E에서 프로바이더 요청이 발생하지 않는다.
 */

import {
    normalizeAuthError,
    type AuthChangeEvent,
    type AuthClient,
    type AuthConfig,
    type AuthOAuthCredentials,
    type AuthOAuthResult,
    type AuthSessionResult,
    type AuthSignInCredentials,
    type AuthSignInResult,
    type AuthSignOutOptions,
    type AuthSignOutResult,
    type AuthSignUpCredentials,
    type AuthSignUpResult,
    type AuthSession,
    type AuthStateListener,
    type AuthUnsubscribe,
    type OAuthProvider,
} from '../auth/contracts.js';
import { createAuthStore, type AuthStore } from '../auth/auth-store.js';
import { LocalGuestSessionClient } from '../auth/local-guest-session.js';
import { createAuthFlow, type AuthFlow } from '../ui/auth/auth-flow.js';

const OFFLINE_ERROR_MESSAGE = 'Authentication provider is not configured';

/**
 * Reads only the public Vite variables. Privileged keys are never accepted.
 * Returns null instead of throwing so the caller can fall back to offline mode.
 */
export function readPublicAuthConfig(
    env: Readonly<Record<string, string | undefined>> = readBuildEnv(),
): AuthConfig | null {
    const url = env['VITE_SUPABASE_URL']?.trim() ?? '';
    const anonKey = env['VITE_SUPABASE_ANON_KEY']?.trim() ?? '';
    if (url === '' || anonKey === '') return null;
    if (/service[_-]?role/i.test(anonKey)) return null;
    return { url, anonKey };
}

function readBuildEnv(): Readonly<Record<string, string | undefined>> {
    return (import.meta as ImportMeta & {
        readonly env?: Readonly<Record<string, string | undefined>>;
    }).env ?? {};
}

function offlineError(provider?: OAuthProvider): ReturnType<typeof normalizeAuthError> {
    return normalizeAuthError({ code: 'provider_error', message: OFFLINE_ERROR_MESSAGE, retryable: false }, provider);
}

/**
 * Provider-free AuthClient. Every account operation resolves to a normalized
 * error instead of performing I/O, so guest play and tests stay offline.
 */
class OfflineAuthClient implements AuthClient {
    private readonly listeners = new Set<AuthStateListener>();

    public async signUp(_credentials: AuthSignUpCredentials): Promise<AuthSignUpResult> {
        return { data: null, error: offlineError() };
    }

    public async signIn(_credentials: AuthSignInCredentials): Promise<AuthSignInResult> {
        return { data: null, error: offlineError() };
    }

    public async signInWithOAuth(credentials: AuthOAuthCredentials): Promise<AuthOAuthResult> {
        return { data: { provider: credentials.provider, url: null }, error: offlineError(credentials.provider) };
    }

    public async getSession(): Promise<AuthSessionResult> {
        return { data: { session: null }, error: null };
    }

    public onAuthStateChange(listener: AuthStateListener): AuthUnsubscribe {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    public async signOut(_options?: AuthSignOutOptions): Promise<AuthSignOutResult> {
        return { data: null, error: null };
    }

    public async refreshSession(): Promise<AuthSessionResult> {
        return { data: { session: null }, error: null };
    }

    /** Test seam: lets the store/flow observe a provider transition without I/O. */
    public emit(event: AuthChangeEvent, session: AuthSession | null): void {
        for (const listener of [...this.listeners]) listener(event, session);
    }
}

export type AuthProviderMode = 'supabase' | 'offline';

export interface AuthRuntime {
    readonly mode: AuthProviderMode;
    readonly client: AuthClient;
    readonly store: AuthStore;
    readonly flow: AuthFlow;
    readonly guestClient: LocalGuestSessionClient;
    /**
     * Drives a provider transition on the offline adapter without any I/O.
     * Returns false when a real provider is configured, so the browser probe
     * can only use it in the network-free path.
     */
    emitProviderEvent(event: AuthChangeEvent, session: AuthSession | null): boolean;
}

async function createAuthClient(config: AuthConfig | null): Promise<{ mode: AuthProviderMode; client: AuthClient }> {
    if (config === null) return { mode: 'offline', client: new OfflineAuthClient() };
    try {
        const module = await import('../auth/supabase-auth-client.js');
        return { mode: 'supabase', client: module.createSupabaseAuthClient(config) };
    } catch {
        // Provider SDK unavailable in this runtime: degrade to offline rather than break boot.
        return { mode: 'offline', client: new OfflineAuthClient() };
    }
}

/**
 * Wires the canonical contract, the backend store, the local guest session, and
 * the UI flow into one runtime and mounts the flow into `container`.
 */
export async function bootstrapAuth(container: HTMLElement): Promise<AuthRuntime> {
    const { mode, client } = await createAuthClient(readPublicAuthConfig());
    const guestClient = new LocalGuestSessionClient();
    const store = createAuthStore(client, { guestClient });
    const flow = createAuthFlow({ container, client, guestClient });
    await flow.mount();
    await store.restoreSession();
    const offline = client instanceof OfflineAuthClient ? client : null;
    return {
        mode,
        client,
        store,
        flow,
        guestClient,
        emitProviderEvent: (event, session) => {
            if (offline === null) return false;
            offline.emit(event, session);
            return true;
        },
    };
}
