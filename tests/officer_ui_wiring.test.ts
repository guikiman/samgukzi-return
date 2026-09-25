/**
 * [Auth/officers] main.ts 배선 검증 — 브라우저 없이.
 *
 * `src/main.ts` 는 최상위에서 DOM 을 만지므로 노드 환경에서 import 할 수 없다.
 * 그래서 이 테스트는 main.ts 가 **실제로 의존하는building block**을 그대로 써서
 * 해석 경로와 degrade 계약을 검증하고, 배선이 코드에 남아 있는지도 확인한다.
 *
 * 검증 축
 *   1. 이름 해석 — 알려진 런타임 무장은 데이터셋 무장으로 풀린다.
 *   2. 동명이인 — 임의로 고르지 않고 `ambiguous` 로 표시된다.
 *   3. degrade — 해석 실패/빈 이름/빈 성향/빈 도장이 예외 없이 degradation 한다.
 *   4. 시나리오 데이터 무결성 — 07_officers.json / relationships.json 불변.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve as resolvePath } from 'node:path';
import {
    resolveOfficerIdByName,
    getBridgeDossierParagraphs,
    listAmbiguousNames,
} from '../src/core/officer_biography_bridge';
import { OFFICER_PROFILES } from '../src/core/officer_profile_schema';
import officers07 from '../src/data/scenarios/07_officers.json';
import relationships from '../src/data/scenarios/relationships.json';

const REPO_ROOT = resolvePath(__dirname, '..');
const MAIN_TS = readFileSync(resolvePath(REPO_ROOT, 'src/main.ts'), 'utf8');

type RosterEntry = { readonly name: string };
const ROSTER = Object.values(officers07 as unknown as Record<string, RosterEntry>);

/** main.ts 의 `StaticOfficerLink` 를 그대로 옮긴 타입(배선 계약의 미러). */
type StaticOfficerLink =
    | { readonly status: 'linked'; readonly id: string; readonly traits: readonly string[]; readonly paragraphs: readonly string[] }
    | { readonly status: 'ambiguous'; readonly name: string; readonly candidateCount: number }
    | { readonly status: 'unlinked'; readonly name: string };

/** main.ts 의 `linkStaticOfficer` 와 동일한 해석 로직(노드에서 실행 가능). */
function linkStaticOfficer(name: string): StaticOfficerLink {
    if (typeof name !== 'string' || name.trim() === '') {
        return { status: 'unlinked', name: '' };
    }
    const resolution = resolveOfficerIdByName(name);
    if (resolution.status === 'not-found') return { status: 'unlinked', name: resolution.name };
    if (resolution.status === 'ambiguous') {
        return { status: 'ambiguous', name: resolution.name, candidateCount: resolution.candidates.length };
    }
    const profile = OFFICER_PROFILES.get(resolution.id);
    if (!profile) return { status: 'unlinked', name: resolution.name };
    const paragraphs = getBridgeDossierParagraphs(profile.id).filter(p => p.trim() !== '');
    return { status: 'linked', id: profile.id, traits: profile.traits, paragraphs };
}

/** main.ts 의 `buildOfficerProfileLines` 와 동일한 degrade 로직. */
function buildOfficerProfileLines(link: StaticOfficerLink, traitLine: string | undefined): string[] {
    const lines: string[] = [];
    if (traitLine !== undefined && traitLine.trim() !== '') {
        lines.push('── 성향 ──', traitLine);
    }
    if (link.status === 'linked' && link.paragraphs.length > 0) {
        lines.push('── 도장 ──', ...link.paragraphs);
    } else if (link.status === 'ambiguous') {
        lines.push('── 도장 ──', `이름이 같은 무장이 ${link.candidateCount}명 있어 기록을 특정할 수 없다.`);
    }
    return lines;
}

// ---------------------------------------------------------------- 1. 이름 해석

describe('runtime officer → static dataset resolution', () => {
    it('resolves a known scenario officer by Korean name', () => {
        const hadowun = linkStaticOfficer('하후돈');
        expect(hadowun.status).toBe('linked');
        if (hadowun.status !== 'linked') throw new Error('expected linked');
        expect(hadowun.id).toMatch(/^off_\d{4}$/);
        expect(OFFICER_PROFILES.get(hadowun.id)).toBeDefined();
    });

    it('resolves at least half of the scenario 07 roster', () => {
        const linked = ROSTER.filter(o => linkStaticOfficer(o.name).status === 'linked');
        expect(linked.length).toBeGreaterThanOrEqual(Math.ceil(ROSTER.length / 2));
    });

    it('carries traits and dossier paragraphs for a linked officer', () => {
        const link = linkStaticOfficer('장송');
        expect(link.status).toBe('linked');
        if (link.status !== 'linked') throw new Error('expected linked');
        expect(Array.isArray(link.traits)).toBe(true);
        expect(link.paragraphs.length).toBeGreaterThan(0);
        for (const p of link.paragraphs) expect(p.trim()).not.toBe('');
    });

    it('links every dossier-bearing officer in the scenario roster without throwing', () => {
        for (const entry of ROSTER) {
            expect(() => linkStaticOfficer(entry.name)).not.toThrow();
            const link = linkStaticOfficer(entry.name);
            if (link.status === 'linked') {
                expect(OFFICER_PROFILES.get(link.id)).toBeDefined();
            }
        }
    });

    it('never resolves an ambiguous homonym name to a single id', () => {
        const link = linkStaticOfficer('순욱');
        expect(link.status).toBe('ambiguous');
        if (link.status !== 'ambiguous') throw new Error('expected ambiguous');
        expect(link.candidateCount).toBeGreaterThanOrEqual(2);
        // 후보가 있다는 사실만 알리고, 정본 id 는 노출하지 않는다.
        expect(link).not.toHaveProperty('id');
        expect(link).not.toHaveProperty('paragraphs');
    });

    it('reports ambiguity for every dataset homonym group', () => {
        for (const group of listAmbiguousNames()) {
            expect(linkStaticOfficer(group.name).status).toBe('ambiguous');
        }
    });

    it('reports unlinked for names absent from the dataset', () => {
        expect(linkStaticOfficer('사오필').status).toBe('unlinked');
        expect(linkStaticOfficer('없는무장').status).toBe('unlinked');
    });
});

// ---------------------------------------------------------------- 2. degrade

describe('degradation never throws and never renders undefined', () => {
    it('degrades on an unknown name instead of throwing', () => {
        const link = linkStaticOfficer('없는무장');
        expect(link.status).toBe('unlinked');
        expect(buildOfficerProfileLines(link, undefined)).toEqual([]);
    });

    it('degrades on a blank name instead of throwing', () => {
        for (const name of ['', '   ']) {
            const link = linkStaticOfficer(name);
            expect(link.status).toBe('unlinked');
            expect(buildOfficerProfileLines(link, undefined)).toEqual([]);
        }
    });

    it('degrades when the trait line is missing', () => {
        const link = linkStaticOfficer('장송');
        expect(link.status).toBe('linked');
        const lines = buildOfficerProfileLines(link, undefined);
        expect(lines.join('\n')).not.toContain('undefined');
        expect(lines[0]).toBe('── 도장 ──');
    });

    it('emits an explicit note for an ambiguous name, not a wrong dossier', () => {
        const lines = buildOfficerProfileLines(linkStaticOfficer('순욱'), undefined);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toBe('── 도장 ──');
        expect(lines[1]).toContain('2명');
    });

    it('never produces undefined / null / NaN in any rendered line', () => {
        const links: StaticOfficerLink[] = [
            linkStaticOfficer('장송'),
            linkStaticOfficer('순욱'),
            linkStaticOfficer('없는무장'),
            linkStaticOfficer(''),
        ];
        for (const link of links) {
            for (const line of buildOfficerProfileLines(link, '성향은 名성 쪽이다.')) {
                expect(line).not.toContain('undefined');
                expect(line).not.toContain('null');
                expect(line).not.toContain('NaN');
            }
        }
    });

    it('is deterministic across repeated calls', () => {
        for (const name of ['장송', '순욱', '없는무장']) {
            expect(JSON.stringify(linkStaticOfficer(name))).toBe(JSON.stringify(linkStaticOfficer(name)));
        }
    });
});

// ---------------------------------------------------------------- 3. main.ts 배선

describe('main.ts wiring is present', () => {
    it('imports the name bridge and the profile registry', () => {
        expect(MAIN_TS).toContain('resolveOfficerIdByName');
        expect(MAIN_TS).toContain('getBridgeDossierParagraphs');
        expect(MAIN_TS).toContain('OFFICER_PROFILES');
    });

    it('enables includeTraitLine on the dialogue branch call', () => {
        expect(MAIN_TS).toContain('includeTraitLine: true');
    });

    it('renders the dossier on the 능력과 경력 page and the trait line on the first page', () => {
        expect(MAIN_TS).toContain('buildOfficerProfileLines');
        expect(MAIN_TS).toContain('conversationBranch.traitLine');
    });

    it('keeps the pre-existing detail stat lines the E2E probes rely on', () => {
        expect(MAIN_TS).toContain('상호작용 기록');
        expect(MAIN_TS).toContain('政治 ${target.stats.politics}');
    });
});

// ---------------------------------------------------------------- 4. 데이터 불변

describe('scenario data is untouched', () => {
    it('keeps cao_pi intelligence at 76', () => {
        const roster = officers07 as unknown as Record<string, { stats: { intelligence: number } }>;
        expect(roster['cao_pi'].stats.intelligence).toBe(76);
    });

    it('keeps the scenario 07 relationship count at 8', () => {
        const raw = relationships as unknown as { scenarios: Record<string, readonly unknown[]> };
        expect(raw.scenarios['07'].length).toBe(8);
    });

    it('leaves the JSON files unmodified relative to HEAD', () => {
        const diff = execFileSync(
            'git',
            ['diff', '--stat', 'HEAD', '--', 'src/data/scenarios/07_officers.json', 'src/data/scenarios/relationships.json'],
            { cwd: REPO_ROOT, encoding: 'utf8' },
        );
        expect(diff.trim()).toBe('');
    });

    it('reports no modification to any file under src/data/', () => {
        const status = execFileSync('git', ['status', '--porcelain', '--', 'src/data/'], { cwd: REPO_ROOT, encoding: 'utf8' });
        expect(status.trim()).toBe('');
    });
});
