import { AUTH_ERROR_CODES } from './contracts.js';
import type { AuthError, AuthErrorCode, OAuthProvider } from './contracts.js';

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

/** Normalize provider failures without retaining token or provider secret fields. */
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
