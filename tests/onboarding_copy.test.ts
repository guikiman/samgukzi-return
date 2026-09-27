/**
 * [461-480] 온보딩 문구 데이터 단위 테스트
 * 파일: tests/onboarding_copy.test.ts
 *
 * 소유권(ONBOARDING-WORKTREES.md PR3): 대상은 src/data/onboarding_copy.json.
 * 이 테스트는 그 JSON 을 "명세"로 삼는다. 파일이 없으면 모듈 해석 실패로
 * 전부 red 가 되고, PR3 이 병합되면 green 이 된다.
 *
 * 검증 축:
 * - JSON 이 파싱되고 모든 항목에 비어 있지 않은 id/title/body 가 있는가
 * - id 가 중복되지 않는가 (객체 키와 항목의 id 도 일치해야 한다)
 * - 스포트라이트 셀렉터가 index.html 의 실제 id 를 가리키는가
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import onboardingCopy from '../src/data/onboarding_copy.json';

interface CopyEntry {
    readonly id: string;
    readonly title: string;
    readonly body: string;
    readonly spotlightSelector: string | null;
}

const ENTRIES = Object.entries(onboardingCopy as Record<string, CopyEntry>);
const IDS = ENTRIES.map(([, e]) => e.id);

/** index.html 에 실제로 존재하는 element id 목록 */
const INDEX_HTML = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const HTML_IDS = new Set(
    [...INDEX_HTML.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]),
);

describe('[461-480] 온보딩 문구 · 데이터 형식 [461-480]', () => {
    it('JSON 이 파싱되고 항목이 하나 이상 있다', () => {
        expect(typeof onboardingCopy).toBe('object');
        expect(onboardingCopy).not.toBeNull();
        expect(Array.isArray(onboardingCopy)).toBe(false); // 키로 인덱싱하는 맵이다
        expect(ENTRIES.length).toBeGreaterThan(0);
    });

    it('모든 항목에 비어 있지 않은 id/title/body 가 있다', () => {
        const bad: string[] = [];
        for (const [key, e] of ENTRIES) {
            if (typeof e.id !== 'string' || e.id.trim() === '') bad.push(`${key}: id`);
            if (typeof e.title !== 'string' || e.title.trim() === '') bad.push(`${key}: title`);
            if (typeof e.body !== 'string' || e.body.trim() === '') bad.push(`${key}: body`);
        }
        expect(bad, JSON.stringify(bad, null, 2)).toEqual([]);
    });

    it('id 가 전부 유일하다', () => {
        expect(new Set(IDS).size).toBe(IDS.length);
    });

    it('객체 키와 항목의 id 가 일치한다 (조회 불일치 방지)', () => {
        for (const [key, e] of ENTRIES) {
            expect(e.id, `키 ${key} 와 id 불일치`).toBe(key);
        }
    });

    it('id 는 소문자 스네이크 케이스 규칙을 지킨다', () => {
        const bad = IDS.filter((id) => !/^[a-z0-9_]+$/.test(id));
        expect(bad, JSON.stringify(bad)).toEqual([]);
    });

    it('본문이 한 문장 이상이며 지나치게 짧지 않다', () => {
        for (const [, e] of ENTRIES) {
            expect(e.body.trim().length, `${e.id} 본문이 너무 짧다`).toBeGreaterThanOrEqual(20);
        }
    });

    it('spotlightSelector 는 문자열이거나 null 이다', () => {
        for (const [, e] of ENTRIES) {
            const ok = e.spotlightSelector === null || typeof e.spotlightSelector === 'string';
            expect(ok, `${e.id} 의 spotlightSelector 형식`).toBe(true);
        }
    });
});

describe('[461-480] 온보딩 문구 · 스포트라이트 셀렉터가 실제 DOM 을 가리키는가', () => {
    it('셀렉터는 #id 형태여야 한다', () => {
        const bad = ENTRIES
            .filter(([, e]) => e.spotlightSelector !== null)
            .map(([, e]) => e.spotlightSelector as string)
            .filter((sel) => !/^#[A-Za-z][\w-]*$/.test(sel));
        expect(bad, JSON.stringify(bad)).toEqual([]);
    });

    it('모든 스포트라이트 대상이 index.html 에 실제로 존재한다', () => {
        const missing = ENTRIES
            .map(([, e]) => e.spotlightSelector)
            .filter((sel): sel is string => sel !== null)
            .map((sel) => sel.slice(1))
            .filter((id) => !HTML_IDS.has(id));
        expect(missing, `index.html 에 없는 id: ${JSON.stringify(missing)}`).toEqual([]);
    });

    it('스포트라이트 없는 항목이 하나 이상은 있다 (첫 안내 단계)', () => {
        const withSpotlight = ENTRIES.filter(([, e]) => e.spotlightSelector !== null).length;
        expect(withSpotlight).toBeGreaterThan(0);
        expect(withSpotlight).toBeLessThan(ENTRIES.length);
    });
});
