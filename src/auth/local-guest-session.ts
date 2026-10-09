import type {
    AuthError,
    AuthUser,
} from './contracts.js';

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

export interface LocalGuestSessionOptions {
    readonly storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    readonly storageKey?: string;
    readonly sessionTtlSeconds?: number;
    readonly now?: () => number;
}

const DEFAULT_GUEST_STORAGE_KEY = 'samgukzi_return_guest_session';
const DEFAULT_GUEST_TTL_SECONDS = 7 * 24 * 3600; // 7 days

function getMemoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
    const store = new Map<string, string>();
    return {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
            store.set(key, value);
        },
        removeItem: (key: string) => {
            store.delete(key);
        },
    };
}

function resolveStorage(custom?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
    if (custom) return custom;
    try {
        if (typeof localStorage !== 'undefined') {
            return localStorage;
        }
    } catch {
        // localStorage might throw in restricted environments (e.g. cross-origin iframe)
    }
    return getMemoryStorage();
}

function generateId(prefix: string): string {
    const randomHex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const ts = Date.now().toString(36);
    return `${prefix}_${ts}_${randomHex}`;
}

export class LocalGuestSessionClient implements GuestSessionClient {
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
    private readonly storageKey: string;
    private readonly sessionTtlSeconds: number;
    private readonly now: () => number;

    constructor(options: LocalGuestSessionOptions = {}) {
        this.storage = resolveStorage(options.storage);
        this.storageKey = options.storageKey ?? DEFAULT_GUEST_STORAGE_KEY;
        this.sessionTtlSeconds = options.sessionTtlSeconds ?? DEFAULT_GUEST_TTL_SECONDS;
        this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
    }

    async signInAsGuest(): Promise<GuestSessionResult> {
        try {
            const existing = await this.getSession();
            if (existing.data !== null) {
                return existing;
            }

            const nowSec = this.now();
            const guestUser: AuthUser = {
                id: generateId('guest_usr'),
                displayName: '게스트 군주',
                isAnonymous: true,
                createdAt: new Date(nowSec * 1000).toISOString(),
            };

            const newSession: GuestSession = {
                user: guestUser,
                sessionId: generateId('guest_sess'),
                expiresAt: nowSec + this.sessionTtlSeconds,
            };

            this.storage.setItem(this.storageKey, JSON.stringify(newSession));
            return { data: newSession, error: null };
        } catch (err) {
            return {
                data: null,
                error: {
                    code: 'unknown',
                    message: err instanceof Error ? err.message : 'Failed to create guest session',
                    retryable: false,
                },
            };
        }
    }

    async getSession(): Promise<GuestSessionResult> {
        try {
            const raw = this.storage.getItem(this.storageKey);
            if (!raw) {
                return { data: null, error: null };
            }

            const parsed = JSON.parse(raw) as GuestSession;
            if (!parsed || typeof parsed !== 'object' || !parsed.user?.id || !parsed.sessionId || typeof parsed.expiresAt !== 'number') {
                this.storage.removeItem(this.storageKey);
                return { data: null, error: null };
            }

            const nowSec = this.now();
            if (parsed.expiresAt <= nowSec) {
                this.storage.removeItem(this.storageKey);
                return { data: null, error: null };
            }

            return { data: parsed, error: null };
        } catch {
            this.storage.removeItem(this.storageKey);
            return { data: null, error: null };
        }
    }

    async signOut(): Promise<GuestSignOutResult> {
        try {
            this.storage.removeItem(this.storageKey);
            return { data: null, error: null };
        } catch (err) {
            return {
                data: null,
                error: {
                    code: 'unknown',
                    message: err instanceof Error ? err.message : 'Failed to clear guest session',
                    retryable: false,
                },
            };
        }
    }
}
