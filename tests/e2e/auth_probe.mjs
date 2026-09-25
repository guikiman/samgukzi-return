#!/usr/bin/env node
/**
 * Browser probe skeleton for the integrated auth surface.
 *
 * It is intentionally opt-in: without AUTH_PROBE_URL it probes a local,
 * deterministic data-URL fixture. An integrated UI can be checked by running
 * this file against a local static server. External URLs are rejected so the
 * probe cannot accidentally call a provider or leak credentials.
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const AUTH_PROBE_URL = process.env.AUTH_PROBE_URL;
const CHROME_ENV = process.env.AUTH_PROBE_CHROME;
const CHROME_CANDIDATES = [
    CHROME_ENV,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : undefined,
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
].filter(Boolean);

const FIXTURE_HTML = `<!doctype html>
<html lang="ko"><body>
<section id="auth-test-root" data-auth-state="anonymous" aria-busy="false" aria-labelledby="auth-test-title">
  <h2 id="auth-test-title">계정 로그인</h2>
  <form aria-label="이메일 인증">
    <label for="auth-test-email">이메일</label><input id="auth-test-email" type="email" autocomplete="email">
    <label for="auth-test-password">비밀번호</label><input id="auth-test-password" type="password" autocomplete="current-password">
    <button type="button" data-auth-action="sign-in">로그인</button>
    <button type="button" data-auth-action="guest">게스트로 시작</button>
  </form>
</section>
</body></html>`;

const DATA_URL = `data:text/html;charset=utf-8,${encodeURIComponent(FIXTURE_HTML)}`;
const VALID_STATES = new Set(['loading', 'authenticated', 'anonymous', 'error']);

function isLocalUrl(value) {
    if (value.startsWith('data:')) return true;
    try {
        const parsed = new URL(value);
        return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]';
    } catch {
        return false;
    }
}

function findChrome() {
    return CHROME_CANDIDATES.find((candidate) => typeof candidate === 'string' && existsSync(candidate));
}

function extractAttribute(html, attribute) {
    const match = html.match(new RegExp(`${attribute}="([^"]*)"`));
    return match?.[1] ?? null;
}

function extractActions(html) {
    return Array.from(html.matchAll(/data-auth-action="([^"]+)"/g), (match) => match[1]);
}

function inspectDocument(html) {
    const state = extractAttribute(html, 'data-auth-state');
    if (state === null) return { status: 'skipped', reason: 'auth surface marker not present' };
    if (!VALID_STATES.has(state)) return { status: 'failed', reason: `unknown auth state: ${state}` };
    return {
        status: 'ok',
        state,
        errorCode: extractAttribute(html, 'data-auth-error-code'),
        hasGuestSession: html.includes('data-guest-session="true"'),
        actions: extractActions(html),
    };
}

function runBrowserProbe(url, chromePath) {
    const result = spawnSync(chromePath, [
        '--headless=new',
        '--disable-gpu',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--no-first-run',
        '--dump-dom',
        '--virtual-time-budget=1500',
        url,
    ], {
        encoding: 'utf8',
        timeout: 15_000,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
    });
    if (result.error || result.status !== 0) {
        return { status: 'failed', reason: result.error?.message ?? `Chrome exited with ${result.status}` };
    }
    return inspectDocument(result.stdout);
}

function main() {
    const url = AUTH_PROBE_URL ?? DATA_URL;
    if (!isLocalUrl(url)) {
        console.error(JSON.stringify({ status: 'failed', reason: 'AUTH_PROBE_URL must be local or a data URL' }));
        process.exitCode = 1;
        return;
    }
    const chromePath = findChrome();
    if (chromePath === undefined) {
        console.log(JSON.stringify({ status: 'skipped', reason: 'Chrome is not installed; selectors are ready for the UI lane' }));
        return;
    }
    const result = runBrowserProbe(url, chromePath);
    console.log(JSON.stringify({ ...result, mode: AUTH_PROBE_URL === undefined ? 'fixture' : 'local-url' }));
    if (result.status === 'failed') process.exitCode = 1;
}

main();
