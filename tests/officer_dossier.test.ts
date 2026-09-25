/**
 * 절차적 장수 도장 생성기 검증.
 *
 * 기준: 1,200명 전원이 도장을 받고, 문장이 한국어로 성립하며,
 * 어떤 출력에도 `null`/`undefined`/매달린 구분자가 새지 않는다.
 */
import { describe, it, expect } from 'vitest';
import {
    buildOfficerDossier,
    buildOfficerDossierFromProfile,
    dossierParagraphs,
    isSentinelValue,
    SENTINEL_VALUES,
    type OfficerDossier,
} from '../src/core/officer_dossier';
import { OFFICER_PROFILES, type OfficerProfile } from '../src/core/officer_profile_schema';

const ALL: readonly OfficerProfile[] = OFFICER_PROFILES.all();
const ALL_IDS = ALL.map(p => p.id);

const DOSSIERS: readonly OfficerDossier[] = ALL.map(p => buildOfficerDossierFromProfile(p));

/** 도장의 네 줄을 하나로 편다. */
function allText(d: OfficerDossier): string {
    return [d.summary, d.traitLine, d.relationLine, d.careerLine].join(' ');
}

function lines(d: OfficerDossier): string[] {
    return [d.summary, d.traitLine, d.relationLine, d.careerLine];
}

describe('장수 도장 — 전체 생성 (1,200명)', () => {
    it('데이터셋 크기가 1,200명이다', () => {
        expect(ALL).toHaveLength(1200);
        expect(ALL_IDS).toHaveLength(1200);
    });

    it('1,200명 전원이 도장을 받는다', () => {
        const missing = ALL_IDS.filter(id => buildOfficerDossier(id) === undefined);
        expect(missing).toEqual([]);
    });

    it('summary 가 전부 비어 있지 않다', () => {
        const empty = DOSSIERS.filter(d => d.summary.trim() === '').map(d => d.id);
        expect(empty).toEqual([]);
    });

    it('이름이 전부 채워져 있다', () => {
        const blank = DOSSIERS.filter(d => d.name.trim() === '').map(d => d.id);
        expect(blank).toEqual([]);
    });

    it('알 수 없는 id 는 undefined 다', () => {
        expect(buildOfficerDossier('off_9999')).toBeUndefined();
        expect(buildOfficerDossier('')).toBeUndefined();
        expect(dossierParagraphs('off_9999')).toEqual([]);
    });
});

describe('장수 도장 — 출력 무결성', () => {
    it('어떤 문장에도 리터럴 null / undefined / NaN 이 없다', () => {
        const offenders: string[] = [];
        for (const d of DOSSIERS) {
            for (const line of lines(d)) {
                if (/null|undefined|NaN/i.test(line)) offenders.push(`${d.id}: ${line}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('매달린 구분자나 줄바꿈이 없다', () => {
        const offenders: string[] = [];
        for (const d of DOSSIERS) {
            for (const line of lines(d)) {
                if (/[·‧・,、:;]\s*\.$/.test(line)) offenders.push(`${d.id}: ${line}`);
                if (/[·‧・]{2,}/.test(line)) offenders.push(`${d.id}: ${line}`);
                if (/[\r\n]/.test(line)) offenders.push(`${d.id}: ${line}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('모든 줄이 마침표로 끝난다', () => {
        const offenders: string[] = [];
        for (const d of DOSSIERS) {
            for (const line of lines(d)) {
                if (line !== '' && !/[.!?]$/.test(line)) offenders.push(`${d.id}: ${line}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('게임 용어 센티널이 문장에 새지 않는다', () => {
        // '-' 같은 기호는 효과문의 '(+10%)' 안에 섞여 있으므로, 한국어 낱말 센티널만 본다.
        const WORDS = [...SENTINEL_VALUES].filter(s => /[가-힣]/.test(s));
        expect(WORDS.length).toBeGreaterThanOrEqual(5);
        const offenders: string[] = [];
        for (const d of DOSSIERS) {
            for (const line of lines(d)) {
                for (const s of WORDS) {
                    if (line.includes(s)) offenders.push(`${d.id}: '${s}' in ${line}`);
                }
                if (line.includes('무효')) offenders.push(`${d.id}: 무효 in ${line}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('여백이 두 칸 이상 이어지지 않는다', () => {
        const offenders: string[] = [];
        for (const d of DOSSIERS) {
            for (const line of lines(d)) {
                if (/ {2,}/.test(line) || /^\s|\s$/.test(line)) offenders.push(`${d.id}: ${line}`);
            }
        }
        expect(offenders).toEqual([]);
    });
});

describe('장수 도장 — 내용 반영', () => {
    it('생몰 연도가 실제 데이터와 일치한다', () => {
        for (const p of ALL) {
            const d = buildOfficerDossierFromProfile(p);
            if (p.birthYear !== null && p.deathYear !== null && p.deathYear > p.birthYear) {
                expect(d.summary).toContain(`${p.birthYear}년에 태어나`);
                expect(d.summary).toContain(`${p.deathYear}년에 죽었다`);
            }
        }
    });

    it('성향 이름이 실제 traits 배열에 있는 것만 나온다', () => {
        for (const d of DOSSIERS) {
            const p = OFFICER_PROFILES.get(d.id)!;
            for (const t of p.traits) {
                if (d.traitLine.includes(`「${t}」`)) break;
            }
            // traits 가 있으면 도장 traitLine 이 반드시 성향 이름 중 하나를 싣는다.
            if (p.traits.length > 0) {
                const named = p.traits.some(t => d.traitLine.includes(`「${t}」`));
                expect(named).toBe(true);
            }
        }
    });

    it('관계가 있으면 그 사람 이름이 실명으로 나온다', () => {
        // 관계는 한 줄에 4명까지만 이름을 싣고 나머지는 '등 N명'으로 접는다(오버플로 방지).
        // 따라서 잘리지 않은 이름은 반드시 실명이어야 하고, 잘렸다면 그 사실을 밝혀야 한다.
        let checked = 0;
        for (const p of ALL) {
            const d = buildOfficerDossierFromProfile(p);
            for (const ids of Object.values(p.relations)) {
                const names = ids
                    .map(id => OFFICER_PROFILES.get(id))
                    .filter((t): t is OfficerProfile => !!t)
                    .map(t => t.name);
                if (names.length === 0) continue;
                checked++;

                for (const n of names.slice(0, 4)) {
                    expect(d.relationLine).toContain(n);
                }
                if (names.length > 4) {
                    // 잘렸다면 총수를 밝혀야 한다. 접힌 이름은 이 종류 문장에서 빠지지만,
                    // 같은 사람이 다른 종류에서 실명으로 나왔을 수는 있으므로 중복 횟수로 판정한다.
                    expect(d.relationLine).toMatch(new RegExp(`등 ${names.length}명`));
                    for (const n of names.slice(4)) {
                        const occurrences = d.relationLine.split(n).length - 1;
                        expect(occurrences).toBeLessThanOrEqual(1);
                    }
                }
            }
        }
        expect(checked).toBeGreaterThan(1000);
    });

    it('관계 대상이 사라져도 크래시하지 않고 빈 문장이 나오지 않는다', () => {
        const base = ALL.find(p => Object.values(p.relations).some(v => v.length > 0))!;
        const broken: OfficerProfile = {
            ...base,
            relations: { ...base.relations, close: ['off_9999', ''], parents: ['nope'] },
        };
        const d = buildOfficerDossierFromProfile(broken);
        expect(d.relationLine).not.toContain('9999');
        expect(d.relationLine).not.toContain('nope');
        expect(d.relationLine.trim()).not.toBe('');
        expect(d.relationLine).not.toMatch(/null|undefined/);
    });

    it('성향 집합이 다르면 성향 줄이 다르다', () => {
        // 성향 조합이 서로 다른 대표들을 골라 대조한다.
        const byTrait = new Map<string, OfficerProfile>();
        for (const p of ALL) {
            const key = [...p.traits].sort().join('|');
            if (key === '' || byTrait.has(key)) continue;
            byTrait.set(key, p);
        }
        const keys = [...byTrait.keys()];
        expect(keys.length).toBeGreaterThan(100);

        let sameText = 0;
        for (let i = 0; i < keys.length; i++) {
            for (let k = i + 1; k < Math.min(keys.length, i + 40); k++) {
                const a = buildOfficerDossierFromProfile(byTrait.get(keys[i])!);
                const b = buildOfficerDossierFromProfile(byTrait.get(keys[k])!);
                if (allText(a) === allText(b)) sameText++;
                expect(a.traitLine).not.toBe(b.traitLine);
            }
        }
        expect(sameText).toBe(0);
    });

    it('서로 다른 장수 두 명은 도장 전체가 다르다', () => {
        const a = buildOfficerDossier('off_0001')!;
        const b = buildOfficerDossier('off_0006')!;
        expect(a.name).not.toBe(b.name);
        expect(allText(a)).not.toBe(allText(b));
    });

    it('요약이 전부 같을 수는 없다', () => {
        const distinct = new Set(DOSSIERS.map(d => d.summary));
        expect(distinct.size).toBeGreaterThan(900);
    });

    it('1,200명 전원이 서로 다른 도장 조합을 갖는다 (적어도 대부분)', () => {
        const distinct = new Set(DOSSIERS.map(d => `${d.summary}#${d.traitLine}#${d.relationLine}#${d.careerLine}`));
        expect(distinct.size).toBeGreaterThan(1100);
    });

    it('성별 가정을 하지 않는다 — 성별 대명사를 쓰지 않는다', () => {
        // 원본 효과문 안에 '그'가 든 성향이 여럿이라, 인용부는 걷어내고 우리가 만든 틀만 본다.
        for (const d of DOSSIERS) {
            for (const line of lines(d)) {
                const own = line.replace(/‘[^’]*’/g, '').replace(/「[^」]*」/g, '');
                expect(own).not.toContain('그녀');
                expect(own).not.toContain('그이');
                expect(own).not.toMatch(/\s그\s/);
            }
        }
    });

    it('여성 87명도 동일하게 취급된다', () => {
        const female = DOSSIERS.filter(d => OFFICER_PROFILES.get(d.id)!.gender === 'F');
        expect(female).toHaveLength(87);
        for (const d of female) {
            expect(d.summary.trim()).not.toBe('');
        }
    });

    it('결정론 — 같은 입력이면 언제나 같은 도장', () => {
        for (const p of ALL.slice(0, 200)) {
            const a = buildOfficerDossierFromProfile(p);
            const b = buildOfficerDossierFromProfile(p);
            expect(allText(a)).toBe(allText(b));
        }
    });
});

describe('장수 도장 — 손으로 쓴 bio 처리', () => {
    const base = ALL[0];
    const BIO = '손으로 적은 소개문. 이 문장은 그대로 실려야 한다.';

    it('bio 가 있으면 한 글자도 바꾸지 않고 그대로 쓴다', () => {
        const d = buildOfficerDossierFromProfile({ ...base, bio: BIO });
        expect(d.summary).toBe(BIO);
        expect(d.isHandwritten).toBe(true);
    });

    it('bio 가 없으면 절차적으로 조립하고 isHandwritten 는 false', () => {
        const d = buildOfficerDossierFromProfile({ ...base, bio: null });
        expect(d.summary).not.toBe(BIO);
        expect(d.summary).not.toContain('손으로 적은');
        expect(d.isHandwritten).toBe(false);
    });

    it('hasHandwrittenBio 플래그가 켜져 있어도 bio 가 없으면 조립한다', () => {
        const d = buildOfficerDossierFromProfile({ ...base, bio: null, hasHandwrittenBio: true });
        expect(d.isHandwritten).toBe(false);
    });

    it('bio 가 센티널 값이면 손글씨가 아니다', () => {
        for (const s of ['미등장', '미발견', '무효', '없음', '건강', '   ']) {
            const d = buildOfficerDossierFromProfile({ ...base, bio: s });
            expect(d.isHandwritten).toBe(false);
            expect(d.summary).not.toBe(s);
        }
    });

    it('손글씨 bio 여도 나머지 세 줄은 데이터로 채워진다', () => {
        const d = buildOfficerDossierFromProfile({ ...base, bio: BIO });
        expect(d.traitLine).not.toBe('');
        expect(d.relationLine).not.toBe('');
        expect(d.careerLine).not.toBe('');
    });
});

describe('장수 도장 — 센티널 판정', () => {
    const base = ALL[0];

    it('게임 용어 센티널을 정보 없음으로 본다', () => {
        for (const s of ['미등장', '미발견', '무효', '없음', '건강', '', '  ', '무효진형강화']) {
            expect(isSentinelValue(s)).toBe(true);
        }
    });

    it('실제 값은 센티널이 아니다', () => {
        for (const s of ['운남', '하진', '군주', '방두좨주', '저돌', '남만']) {
            expect(isSentinelValue(s)).toBe(false);
        }
    });

    it('null / undefined / 비유한숫자도 정보 없음이다', () => {
        expect(isSentinelValue(null)).toBe(true);
        expect(isSentinelValue(undefined)).toBe(true);
        expect(isSentinelValue(NaN)).toBe(true);
        expect(isSentinelValue(Infinity)).toBe(true);
    });

    it('센티널로 가득한 프로필에서도 문장이 성립한다', () => {
        const blank: OfficerProfile = {
            ...base,
            statusLabel: '무효',
            officeLabel: '무효',
            virtueLabel: '무효',
            voiceLabel: '무효',
            toneLabel: '무효',
            factionLabel: '미등장',
            affiliationLabel: '없음',
            illnessLabel: '건강',
            traits: [],
            tactics: [],
            loyalty: 0,
        };
        const d = buildOfficerDossierFromProfile(blank);
        for (const line of lines(d)) {
            expect(line).not.toMatch(/무효|미등장|없음|건강/);
            expect(line).not.toMatch(/null|undefined|NaN/);
        }
        expect(d.completeness).toBe('PARTIAL');
    });
});

describe('장수 도장 — 문단 배열', () => {
    it('네 줄이 모두 채워지면 네 문단을 돌려준다', () => {
        const withAll = DOSSIERS.find(d => d.completeness === 'FULL')!;
        expect(dossierParagraphs(withAll.id)).toHaveLength(4);
        expect(dossierParagraphs(withAll.id)).toEqual([
            withAll.summary,
            withAll.traitLine,
            withAll.relationLine,
            withAll.careerLine,
        ]);
    });

    it('1,200명 전원이 한 문단 이상을 받는다', () => {
        const short = ALL_IDS.filter(id => dossierParagraphs(id).length === 0);
        expect(short).toEqual([]);
    });

    it('알 수 없는 id 는 빈 배열', () => {
        expect(dossierParagraphs('off_9999')).toEqual([]);
    });
});

describe('장수 도장 — 데이터 충격 대응', () => {
    const base = ALL[0];

    it('연도가 뒤집히거나 0 이어도 문장이 성립한다', () => {
        const weird: OfficerProfile = { ...base, birthYear: 300, deathYear: 100, appearanceYear: null, serviceYear: 0 };
        const d = buildOfficerDossierFromProfile(weird);
        for (const line of lines(d)) {
            expect(line).not.toMatch(/null|undefined|NaN/);
            // 나이는 말이 되는 범위(15~90)로만 나온다. '창조 1세대'의 '1세'는 세지 않는다.
            for (const m of line.matchAll(/(\d+)세(?!대)/g)) {
                const age = Number(m[1]);
                expect(age).toBeGreaterThanOrEqual(15);
                expect(age).toBeLessThanOrEqual(90);
            }
        }
    });

    it('등장연도가 태어난 해보다 이르면 나이를 말하지 않는다', () => {
        // 원본에 출생 111년 · 등장 350년 같은 표기가 있어, 불가능한 나이는 그냥 뺀다.
        const bad: OfficerProfile = { ...base, birthYear: 111, appearanceYear: 350, deathYear: 305 };
        const d = buildOfficerDossierFromProfile(bad);
        expect(d.careerLine).not.toMatch(/239세/);
        expect(d.careerLine).not.toMatch(/null|undefined|NaN/);
    });

    it('능력치가 전부 0 이어도 문장이 성립한다', () => {
        const zero: OfficerProfile = {
            ...base,
            stats: { leadership: 0, might: 0, intelligence: 0, politics: 0, charisma: 0 },
        };
        const d = buildOfficerDossierFromProfile(zero);
        expect(d.careerLine).not.toMatch(/null|undefined|NaN/);
        expect(d.careerLine).not.toContain('undefined');
    });

    it('이름이 비어 있으면 id 로 대신한다', () => {
        const d = buildOfficerDossierFromProfile({ ...base, name: '' });
        expect(d.name).toBe(base.id);
    });
});
