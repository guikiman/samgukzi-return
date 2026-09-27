/**
 * 장수 도장(officer dossier) 프로시저 생성기 — 삼국지14PK 정리표 기준.
 *
 * 1,200명 중 대부분이 `bio: null` 이라 게임 안에 서술문이 거의 없다. 이 모듈은
 * 정적 프로필(officer_profile_schema.ts)의 실제 필드만으로 한국어 도장을 합성한다.
 * personality_text_generator.ts 의 8개 성격 버킷과는 무관하며, 무작위성也没有 없다.
 *
 * 설계 원칙
 *  1. 결정론 — 같은 id 면 언제나 같은 문장. `Math.random()` 을 쓰지 않는다.
 *  2. 없는 것은 없는 대로 — 게임 용어 센티널(미등장/미발견/무효/없음/건강 등)은
 *     '정보 없음' 으로 읽고 문장에서 아예 뺀다. 빈칸을 세력·직위 문장으로 메우지 않는다.
 *  3. 출력 무결성 — 어떤 조합에서도 리터럴 `null` / `undefined` / `NaN` / 매달린 구분자
 *     (`,` `·` 로 끝나는 꼬리)가 새지 않도록 마지막에 정제한다.
 *  4. 성별 중립 — 무장/인물 같은 중립 명사만 쓰고, `gender` 필드로 가정을 만들지 않는다.
 */

import { OFFICER_PROFILES } from './officer_profile_schema.js';
import type { OfficerProfile, OfficerRelationKind } from './officer_profile_schema.js';
import { getPersonalityEffect } from './rtk14_reference_data.js';
import type { OfficerID } from './types.js';

// ---------------------------------------------------------------- 공개 타입

export interface OfficerDossier {
    readonly id: OfficerID;
    readonly name: string;
    /** 1~2문장짜리 개요. 손글씨 bio 가 있으면 그대로. */
    readonly summary: string;
    /** 성향(trait) — 이름과 실제 효과문으로 풀어쓴다. */
    readonly traitLine: string;
    /** 인맥 — 부모/배우자/의형제/인연/원수를 실명으로. */
    readonly relationLine: string;
    /** 경력 — 등장·관직·충성도·능력치 편향. */
    readonly careerLine: string;
    /** true 면 손으로 쓴 bio 를 그대로 실었다. */
    readonly isHandwritten: boolean;
    /** 네 줄이 모두 실제 필드에서 나왔으면 FULL, 우회 표현이 하나라도 있으면 PARTIAL. */
    readonly completeness: 'FULL' | 'PARTIAL';
}

// ---------------------------------------------------------------- 센티널

/**
 * '값이 있다'는 뜻이 아니라 '표기 칸만 채운 게임 용어'다. 문장에 넣으면 비문장이 된다.
 * `무효` 계열(무효로 시작하거나 무효를 포함한 값)은 전부 여기 포함한다.
 */
export const SENTINEL_VALUES: ReadonlySet<string> = new Set([
    '미등장',
    '미발견',
    '무효',
    '없음',
    '건강',
    '미지정',
    '미상',
    '불명',
    '미기록',
    '해당없음',
    'N/A',
    'n/a',
    '-',
    '--',
    '?',
]);

/** null/빈 문자열/게임 용어 센티널이면 true(=정보 없음). */
export function isSentinelValue(raw: unknown): boolean {
    if (raw === null || raw === undefined) return true;
    if (typeof raw === 'number') return !Number.isFinite(raw);
    if (typeof raw !== 'string') return true;
    const t = raw.trim();
    if (t === '') return true;
    if (SENTINEL_VALUES.has(t)) return true;
    return t.includes('무효');
}

/** 센티널이 아닌 문자열만 돌려준다(없으면 undefined). */
function text(raw: string | null | undefined): string | undefined {
    if (isSentinelValue(raw)) return undefined;
    return (raw as string).trim();
}

/** 유한한 숫자만 통과시킨다(0 은 값이 있는 것으로 본다). */
function year(raw: number | null | undefined): number | undefined {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
    return Math.trunc(raw);
}

// ---------------------------------------------------------------- 조사/어미

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;

function lastHangulSyllable(word: string): string {
    for (let i = word.length - 1; i >= 0; i--) {
        const code = word.charCodeAt(i);
        if (code >= HANGUL_START && code <= HANGUL_END) return word.charAt(i);
        if (/[0-9A-Za-z]/.test(word.charAt(i))) return '';
    }
    return '';
}

function hasBatchim(word: string): boolean {
    const ch = lastHangulSyllable(word);
    if (ch === '') return false;
    return (ch.charCodeAt(0) - HANGUL_START) % 28 !== 0;
}

/** 받침 유무로 조사를 고른다. */
function josa(word: string, withBatchim: string, withoutBatchim: string): string {
    return hasBatchim(word) ? withBatchim : withoutBatchim;
}

const topicOf = (w: string): string => josa(w, '은', '는');
const subjectOf = (w: string): string => josa(w, '이', '가');
const objectOf = (w: string): string => josa(w, '을', '를');
const andOf = (w: string): string => josa(w, '과', '와');

/** '가' 를 쓰지 않는 연결형 나열: 「A」, 「B」와 「C」 */
function joinWithLast(items: readonly string[]): string {
    if (items.length === 0) return '';
    if (items.length === 1) return items[0];
    const last = items[items.length - 1];
    return `${items.slice(0, -1).join(', ')}${andOf(last)} ${last}`;
}

// ---------------------------------------------------------------- 출력 정제

const FORBIDDEN_TOKENS = /null|undefined|NaN/gi;
/** '·' '‧' '・' 연속 — 매달린 구분자. */
const DUP_SEPARATOR = /[·‧・]{2,}/g;
/** 문장 끝에 걸린 구분자(쉼표/가운뎃점/콜론). */
const DANGLING_TAIL = /[·‧・\s,、:;]+$/;
/** ' ,' 처럼 구분자 앞에 남은 공백. */
const LOOSE_SEPARATOR = /[·‧・]\s+/g;
/** '공백 ,' 처럼 쉼표 앞에 남은 공백. */
const LOOSE_COMMA = /\s+([,、])/g;

function collapse(input: string): string {
    return input.replace(/\s+/g, ' ').trim();
}

/** 생성된 문장을 화면에 낼 수 있는 형태로 마감한다. */
function tidy(raw: string): string {
    let out = collapse(raw.replace(FORBIDDEN_TOKENS, ''));
    out = out.replace(DUP_SEPARATOR, '·');
    out = out.replace(LOOSE_SEPARATOR, '·');
    out = out.replace(LOOSE_COMMA, '$1');
    // 쉼표가 이미 있는 자리에 가운뎃점을 또 박지 않는다.
    out = out.replace(/·(?=[,、])/g, '');
    // 조사·어미 앞의 가운뎃점은 원래 실수이므로 걷어낸다.
    out = out.replace(/[·‧・](?=[가-힣])/g, '');
    out = out.replace(DANGLING_TAIL, '');
    out = out.replace(/[.]{2,}/g, '.');
    if (out === '') return '';
    if (!/[.!?]$/.test(out)) out += '.';
    return out;
}

// ---------------------------------------------------------------- 조립 재료

type Flags = { fallback: boolean };

/** 값이 없으면 조용히 생략한다. summary 의 속격 나열에만 쓴다. */
function push(list: string[], part: string | undefined): void {
    if (part !== undefined && part !== '') list.push(part);
}

function generationPhrase(p: OfficerProfile): string | undefined {
    const g = year(p.generation);
    if (g === undefined || g <= 0) return undefined;
    return g === 1 ? '창조 1세대' : `${g}세대`;
}

/** 세력 · 본관 · 소속지. 센티널이면 전부 undefined. */
function belongingPhrase(p: OfficerProfile): string | undefined {
    const faction = text(p.factionLabel);
    const affiliation = text(p.affiliationLabel) ?? text(p.locationLabel);
    const corps = text(p.corpsLabel);
    if (faction && affiliation) return `${faction} 편 ${affiliation} 소속`;
    if (faction) return `${faction} 편`;
    if (corps && affiliation) return `${corps} 체 ${affiliation} 소속`;
    if (corps) return `${corps} 체`;
    if (affiliation) return `${affiliation} 지역`;
    return undefined;
}

function statusPhrase(p: OfficerProfile): string | undefined {
    const s = text(p.statusLabel);
    return s ? `${s} 신분` : undefined;
}

function officePhrase(p: OfficerProfile): string | undefined {
    const o = text(p.officeLabel);
    return o ? `${o} 자리` : undefined;
}

function gradePhrase(p: OfficerProfile): string | undefined {
    const g = year(p.grade);
    if (g === undefined || g < 1 || g > 5) return undefined;
    return `${g}등급`;
}

// ---------------------------------------------------------------- summary

interface Built {
    readonly text: string;
    readonly flags: Flags;
}

function buildSummary(p: OfficerProfile): Built {
    const bio = text(p.bio);
    if (bio !== undefined) {
        // 손으로 쓴 소개는 한 글자도 고치지 않는다.
        return { text: bio, flags: { fallback: false } };
    }

    const flags: Flags = { fallback: false };
    const sentences: string[] = [];

    const b = year(p.birthYear);
    const d = year(p.deathYear);
    if (b !== undefined && d !== undefined && d > b) {
        sentences.push(`${b}년에 태어나 ${d}년에 죽었다.`);
    } else if (b !== undefined) {
        sentences.push(`${b}년 무렵 세상에 태어났다.`);
    } else if (d !== undefined) {
        sentences.push(`${d}년에 죽었다.`);
    }
    // 출생·사망 연도는 도장 첫머리에 반드시 오는 정보라, 없으면 대체 문장 없이 조용히 뺀다.
    if (b === undefined && d === undefined) flags.fallback = true;

    const nouns: string[] = [];
    push(nouns, belongingPhrase(p));
    push(nouns, generationPhrase(p));
    push(nouns, statusPhrase(p));
    push(nouns, officePhrase(p));
    push(nouns, gradePhrase(p));
    if (nouns.length > 0) sentences.push(`${nouns.join(', ')}이었다.`);
    else flags.fallback = true;

    return { text: tidy(sentences.join(' ')), flags };
}

// ---------------------------------------------------------------- trait

/** 효과문 안에 마침표/줄바꿈이 섞여 있으므로 문장에 박을 때 정리한다. */
function normalizeEffect(raw: string): string {
    return collapse(
        raw
            .replace(/[.。]/g, ',')
            .replace(/[，、]/g, ',')
            .replace(/,+/g, ',')
            .replace(/,\s*$/, ''),
    );
}

const TIER_WORD: Record<string, string> = {
    GOLD: '금패',
    BLUE: '은패',
    RED: '녹패',
};

function buildTraitLine(p: OfficerProfile): Built {
    const flags: Flags = { fallback: false };
    const traits = p.traits.map(t => text(t)).filter((t): t is string => t !== undefined);
    const uniq = [...new Set(traits)].slice(0, 5);

    if (uniq.length > 0) {
        // 성향 이름은 전부 싣는다(최대 5개). 일부만 보여 주면 성향이 다른 두 명이
        // 같은 traitLine 을 낼 수 있어서, 이름 출처로는 항상 전체를 노출한다.
        const shown = uniq;
        const named = shown.map(t => `「${t}」`);
        const count = uniq.length;
        const effects = shown
            .slice(0, 3)
            .map(t => {
                const def = getPersonalityEffect(t);
                const eff = def ? text(def.effect) : undefined;
                if (eff === undefined) return undefined;
                return { trait: t, text: normalizeEffect(eff) };
            })
            .filter((e): e is { trait: string; text: string } => e !== undefined);

        const head = `${named.join(', ')}${count === 1 ? '' : ` ${count}가지`}`;
        const rest = count - Math.min(3, count);

        if (effects.length === 0) {
            const tier = TIER_WORD[getPersonalityEffect(shown[0])?.tier ?? ''] ?? '무패';
            return { text: tidy(`특성은 ${head}의 ${tier} 성향으로 읽힌다.`), flags };
        }
        const quoted = effects.map(e => `‘${e.text}’`).join(', ');
        // 3개를 넘는 성향은 이름만 전부 밝히고, 효과문은 앞의 세 개까지만 인용한다.
        const tail = rest > 0 ? ` 나머지 ${rest}가지도 함께 지녔다.` : '';
        return {
            text: tidy(`특성은 ${head}다. 그중 ${quoted}의 효과를 보인다.${tail}`),
            flags,
        };
    }

    // 성향 칸이 비었다면 덕목 · 정책 · 전법 · 음성 표기로 채운다.
    // 성향 칸이 비었다면 덕목 · 정책 · 전법 · 기색 표기로 대신 채운다.
    // 성향이 아니므로 PARTIAL 로 친다 — 실제 성향과 같은 문장으로 가장하지 않는다.
    flags.fallback = true;
    const parts: string[] = [];
    const virtue = text(p.virtueLabel);
    if (virtue) parts.push(`덕목은 ‘${virtue}’ 쪽이다`);
    const policy = text(p.policyLabel);
    if (policy) parts.push(`다뤄 온 일은 ‘${policy}’이었다`);

    const tactics = p.tactics.map(t => text(t)).filter((t): t is string => t !== undefined);
    if (tactics.length > 0) {
        const shown = [...new Set(tactics)].slice(0, 3);
        parts.push(`전법은 ${shown.map(t => `‘${t}’`).join(', ')}에 걸었다`);
    }
    const voice = text(p.toneLabel) ?? text(p.voiceLabel);
    if (voice) parts.push(`평소 기색은 ‘${voice}’ 쪽이다`);

    if (parts.length === 0) {
        return { text: tidy('성향을 가리키는 기록이 남아 있지 않다.'), flags };
    }
    return { text: tidy(`${parts.join(', ')}.`), flags };
}

// ---------------------------------------------------------------- relation

/**
 * 관계 종류별 완결 문장 템플릿.
 * `list` 는 'A, B, C 등 N명' 형태의 나열이고 조사는 나열 끝 단어의 받침을 본다.
 * ('…등 7명'의 조사는 '명'이 받침이 없다는 사실이 자연스럽게 반영된다.)
 */
const RELATION_TEMPLATE: Record<OfficerRelationKind, (list: string) => string> = {
    parents: list => `부모로는 ${list}에게서 태어났다.`,
    spouse: list => `배우자는 ${list}${andOf(list)} 가지를 이뤘다.`,
    swornSiblings: list => `의 형제는 ${list}${andOf(list)} 맑맹을 맺었다.`,
    close: list => `인연으로 ${list}${andOf(list)} 자주 오갔다.`,
    hate: list => `원수로 ${list}${andOf(list)} 끝없이 맞서웠다.`,
};

/** 실명 목록을 화면용 나열 문자열로 접는다. 길어지면 앞 4명만 싣고 수로 마감. */
function nameList(names: readonly string[]): string {
    const shown = names.slice(0, 4);
    if (shown.length < names.length) return `${joinWithLast(shown)} 등 ${names.length}명`;
    return joinWithLast(shown);
}

const RELATION_ORDER: readonly OfficerRelationKind[] = [
    'parents',
    'spouse',
    'swornSiblings',
    'close',
    'hate',
];

/** 이름 표기가 뒤섞인 데이터에서 실명을 안전하게 꺼낸다. */
function nameOf(id: OfficerID): string | undefined {
    if (typeof id !== 'string' || id === '') return undefined;
    const target = OFFICER_PROFILES.get(id);
    if (!target) return undefined;
    const n = text(target.name);
    return n === undefined ? undefined : n;
}

function buildRelationLine(p: OfficerProfile): Built {
    const flags: Flags = { fallback: false };
    const sentences: string[] = [];

    for (const kind of RELATION_ORDER) {
        const raw = p.relations?.[kind];
        if (!Array.isArray(raw) || raw.length === 0) continue;
        const names: string[] = [];
        for (const id of raw) {
            const n = nameOf(id);
            if (n !== undefined) names.push(n);
        }
        if (names.length === 0) continue;
        sentences.push(RELATION_TEMPLATE[kind](nameList(names)));
    }

    if (sentences.length === 0) {
        flags.fallback = true;
        return { text: tidy('함께 서거나 맞섰던 사람은 표에 남아 있지 않다.'), flags };
    }
    return { text: tidy(sentences.join(' ')), flags };
}

// ---------------------------------------------------------------- career

const STAT_WORD = {
    leadership: '통솔',
    might: '무력',
    intelligence: '지략',
    politics: '정치',
    charisma: '매력',
} as const;

type StatKey = keyof typeof STAT_WORD;

const STAT_KEYS = Object.keys(STAT_WORD) as StatKey[];

interface StatPick {
    readonly key: StatKey;
    readonly value: number;
}

/** 다섯 능력치를 단조 정렬해 무엇이 강한지 알려준다. */
function describeStats(p: OfficerProfile): string | undefined {
    const stats = p.stats;
    if (!stats || typeof stats !== 'object') return undefined;

    const picks: StatPick[] = [];
    for (const k of STAT_KEYS) {
        const v = stats[k];
        if (typeof v === 'number' && Number.isFinite(v)) picks.push({ key: k, value: v });
    }
    if (picks.length === 0) return undefined;

    picks.sort((a, b) => (b.value - a.value) || STAT_KEYS.indexOf(a.key) - STAT_KEYS.indexOf(b.key));
    const top = picks[0];
    const bottom = picks[picks.length - 1];
    const listed = STAT_KEYS.map(k => `${STAT_WORD[k]} ${stats[k]}`).join(', ');

    const topWord = STAT_WORD[top.key];
    // 끝형이 달라질 수 있어 '…인' 꼴로 통일한다. 관형이 면 '…없는' 으로 끝나 '없다이다'를 피한다.
    const topGrade =
        top.value >= 75 ? '월등한 수준인' : top.value >= 55 ? '훌륭한 편인' : top.value >= 35 ? '보통을 넘는' : '두드러진 장점이 없는';
    const lead = ` 능력 ${listed}으로, ${topWord + subjectOf(topWord)} 가장 높은 ${top.value}로 ${topGrade} 무장이다`;

    if (top.key === bottom.key) return tidy(`${lead} 어느 하나가 과하게 치우치지도 않았다.`);
    const lowWord = STAT_WORD[bottom.key];
    const lowGrade = bottom.value >= 55 ? '약하지도 않다' : bottom.value >= 35 ? '평균에 못 미친다' : '가장 미더운 자리다';
    return tidy(`${lead} 다만 ${lowWord + topicOf(lowWord)} ${bottom.value}로 ${lowGrade}.`);
}

/** 충성도 수치를 등급 문구로 바꾼다. 0 이하는 정보 없음으로 본다. */
const LOYALTY_WORD: readonly (readonly [number, string])[] = [
    [250, '주인을 바꿀 생각이 눈곱만치도 없는 심부'],
    [150, '명령이 있으면 거꾸로 하지 않은 사람'],
    [120, '주인이 시키는 바를 잘 거스르지 않았다'],
    [100, '주인에게 한 마음으로 붙은 사람'],
    [92, '다만 마음이 아직 굳지는 않은 사람'],
    [1, '충성에는 아직 자기가 얇은 사람'],
];

function loyaltyPhrase(raw: number | null | undefined): string | undefined {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
    for (const [floor, word] of LOYALTY_WORD) {
        if (raw >= floor) return `충성도 ${raw}로, ${word}이었다`;
    }
    return undefined;
}

function buildCareerLine(p: OfficerProfile): Built {
    const flags: Flags = { fallback: false };
    const sentences: string[] = [];

    const b = year(p.birthYear);
    const appear = year(p.appearanceYear);
    const service = year(p.serviceYear);
    const d = year(p.deathYear);

    if (appear !== undefined) {
        const age = b !== undefined ? appear - b : undefined;
        if (age !== undefined && age >= 15 && age <= 90) {
            sentences.push(`${appear}년, ${age}세에 무대에 섰다.`);
        } else {
            sentences.push(`${appear}년 무대에 섰다.`);
        }
    } else {
        flags.fallback = true;
    }

    if (service !== undefined && service > 0 && service !== appear) {
        sentences.push(`투입 시점은 ${service}년부터였다.`);
    }

    const office = text(p.officeLabel);
    if (office !== undefined) {
        sentences.push(`직위는 ${office + josa(office, '으로', '로')} 기록에 남아 있다.`);
    }

    const loyalty = loyaltyPhrase(p.loyalty);
    if (loyalty !== undefined) sentences.push(`${loyalty}.`);

    const stat = describeStats(p);
    // 능력치 편향은 1,200명 전원이 채워져 있으므로 경로가 지로 거의 없다.
    if (stat !== undefined && stat !== '') sentences.push(stat);
    else flags.fallback = true;

    if (appear !== undefined && d !== undefined && d > appear) {
        const span = d - appear;
        sentences.push(`무대에 올라온 지 ${span}년을 두고 떠났다.`);
    }

    if (sentences.length === 0) {
        flags.fallback = true;
        return { text: tidy('이력에 걸릴 만한 기록이 남아 있지 않다.'), flags };
    }
    return { text: tidy(sentences.join(' ')), flags };
}

// ---------------------------------------------------------------- 공개 API

/** 이름만으로 도장을 만든다. 알 수 없는 id 면 undefined. */
function resolveName(p: OfficerProfile): string {
    const n = text(p.name);
    return n ?? p.id;
}

/**
 * 프로필 하나에서 도장을 조립한다.
 * 결정론적이며 같은 입력에는 언제나 같은 출력을 낸다.
 */
export function buildOfficerDossierFromProfile(p: OfficerProfile): OfficerDossier {
    const name = resolveName(p);
    const summary = buildSummary(p);
    const trait = buildTraitLine(p);
    const relation = buildRelationLine(p);
    const career = buildCareerLine(p);

    return {
        id: p.id,
        name,
        summary: summary.text,
        traitLine: trait.text,
        relationLine: relation.text,
        careerLine: career.text,
        isHandwritten: text(p.bio) !== undefined,
        completeness: summary.flags.fallback || trait.flags.fallback || relation.flags.fallback || career.flags.fallback
            ? 'PARTIAL'
            : 'FULL',
    };
}

/** id 로 도장을 찾는다. 레지스트리에 없으면 undefined. */
export function buildOfficerDossier(id: OfficerID): OfficerDossier | undefined {
    if (typeof id !== 'string' || id === '') return undefined;
    const p = OFFICER_PROFILES.get(id);
    if (!p) return undefined;
    return buildOfficerDossierFromProfile(p);
}

/** UI 가 그대로 흘려보낼 문단 배열. 빈 줄은 걸러 낸다. */
export function dossierParagraphs(id: OfficerID): string[] {
    const d = buildOfficerDossier(id);
    if (!d) return [];
    return [d.summary, d.traitLine, d.relationLine, d.careerLine].filter(s => s !== '');
}
