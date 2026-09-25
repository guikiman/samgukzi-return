import type { Officer, OfficerID } from './types.js';
import {
    AXIS_LABELS,
    DIFFERENTIATION_AXES,
    accumulateTraits,
    describeTendency,
    normalizeTendency,
    type DifferentiationAxis,
    type OfficerTendency,
} from './officer_differentiation.js';
import { OFFICER_PROFILES } from './officer_profile_schema.js';

/** [90] 대화 분기에서 사용할 선택지. */
export interface ConversationBranchChoice {
    id: string;
    label: string;
    description: string;
    affinityDelta: number;
}

/** [90] 무장과 주공의 대화 분기 결과. */
export interface ConversationBranch {
    id: string;
    title: string;
    speaker: string;
    text: string;
    choices: ConversationBranchChoice[];
    /**
     * 성향(trait) 한 줄 요약 — `describeTendency` 출력.
     * `getDialogueBranch(..., { includeTraitLine: true })` 로 요청했을 때만 채워진다.
     * 성향 정보를 모르면 필드 자체가 없다(undefined).
     */
    traitLine?: string;
}

/**
 * [90] 대화 엔진이 보는 무장 입력.
 *
 * 기존 호출자 호환을 위해 `name` / `personality` 만 넘겨도 그대로 동작한다(성향 정보 없음).
 * 성향을 쓰려면 아래 둘 중 하나를 추가로 넘긴다:
 *   - `id`     : officer_profile_schema.ts 에서 trait 을 조회한다(미해결 id 는 안전하게 무시).
 *   - `traits` : 이미 뽑아둔 trait 이름 배열을 직접 넘긴다.
 */
export type DialogueOfficer = Pick<Officer, 'name' | 'personality'> & {
    /** officer_profile_schema.ts 의 키(off_NNNN). 없어도 되고, 안 풀려도 안전하다. */
    id?: OfficerID;
    /** trait 이름 배열. 158종 중 일부. 빈 배열/미지정trait 은 안전하게 무시된다. */
    traits?: readonly string[];
};

/** [90] getDialogueBranch 선택 옵션. */
export interface DialogueOptions {
    /** true 면 결과에 trait 요약 줄(describeTendency)을 채운다. */
    includeTraitLine?: boolean;
}

const KEYWORD_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
    [/전투|무력|武力|무장|훈련|병|전장|刀的|刀/i, 'military'],
    [/政务|내정|도시|치안|민심|방치|금전| taxed|tax/i, 'domestic'],
    [/情報|첩보|외교|손|정계|사기|negoti|外交/i, 'diplomacy'],
    [/兵法|군사|책략|계략|전술|병법|谋|謀/i, 'strategy'],
    [/私|개인|가족|가문|노년|은퇴|평생|人生/i, 'personal'],
];

function normalizeKeyword(keyword: string): string {
    return keyword.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * trait 이름 배열로부터 성향 벡터를 만든다(officer_differentiation 과 동일한 규칙).
 * 매핑되지 않은 trait / 빈 배열이면 성향을 만들지 못한다(undefined).
 * 결정론이며 Math.random 을 쓰지 않는다.
 */
function buildTendencyFromTraits(
    id: OfficerID,
    name: string,
    traits: readonly string[],
): OfficerTendency | undefined {
    const known = traits.filter(t => typeof t === 'string' && t.trim() !== '');
    if (known.length === 0) return undefined;
    const raw = accumulateTraits(known);
    const dominant = DIFFERENTIATION_AXES
        .map(axis => ({ axis, value: raw[axis] }))
        .filter(x => x.value !== 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 3);
    return { id, name, raw, normalized: normalizeTendency(raw), dominant, traits: [...known] };
}

/**
 * 무장 입력에서 성향을 안전하게 뽑는다.
 *  1) `traits` 가 있으면 그것을 쓴다.
 *  2) 없으면 `id` 로 정적 프로필을 조회한다. 조회 실패/미지원은 undefined(안전 무시).
 * 이름으로는 절대 조회하지 않는다 — 동명이인 73그룹이 있어 모호하다.
 */
function resolveTendency(officer: DialogueOfficer | null | undefined): OfficerTendency | undefined {
    if (!officer) return undefined;
    const name = typeof officer.name === 'string' && officer.name.trim() !== '' ? officer.name : '무명';
    if (Array.isArray(officer.traits)) {
        const t = buildTendencyFromTraits(officer.id ?? name, name, officer.traits);
        if (t) return t;
    }
    if (typeof officer.id === 'string' && officer.id !== '') {
        const profile = OFFICER_PROFILES.get(officer.id);
        if (profile) return buildTendencyFromTraits(profile.id, profile.name, profile.traits);
    }
    return undefined;
}

/**
 * branch 별 축 가중치. stats 비교가 아니라 8축 성향 벡터만 본다.
 * 음수 축은 점수에 기여하지 않는다(감점이라기보다 "그 축 성향이 없음").
 */
const BRANCH_AXES: Readonly<Record<string, Partial<Record<DifferentiationAxis, number>>>> = {
    military: { aggression: 3, recklessness: 2, resolve: 1 },
    strategy: { cunning: 3, resolve: 1 },
    domestic: { administration: 3, mercy: 2 },
    diplomacy: { social: 3, mercy: 1 },
    personal: { mercy: 2, resolve: 1 },
};

/** 동점 처리 순서 — 결정론을 위한 고정 순서. */
const BRANCH_ORDER: readonly string[] = ['military', 'strategy', 'domestic', 'diplomacy', 'personal'];

/** 성향 벡터에서 가장 점수가 높은 branch id. 축이 하나도 없으면 undefined. */
function branchIdFromTendency(tendency: OfficerTendency): string | undefined {
    let best: string | undefined;
    let bestScore = 0;
    for (const branchId of BRANCH_ORDER) {
        const weights = BRANCH_AXES[branchId];
        if (!weights) continue;
        let score = 0;
        for (const axis of DIFFERENTIATION_AXES) {
            const weight = weights[axis];
            if (weight === undefined) continue;
            const value = tendency.raw[axis];
            if (value > 0) score += weight * value;
        }
        if (score > bestScore) {
            bestScore = score;
            best = branchId;
        }
    }
    return best;
}

/**
 * 무장마다 달라지는 도입 프레이밍 한 문장.
 * 대표 축 이름 + 상위 trait 이름을 써서, 같은 branch 안에서도 말이 달라지게 한다.
 * 성향 정보가 없으면 undefined — 호출자는 원래 문장을 그대로 쓴다.
 */
function buildFraming(tendency: OfficerTendency | undefined): string | undefined {
    if (!tendency || tendency.dominant.length === 0) return undefined;
    const axes = tendency.dominant
        .slice(0, 2)
        .map(d => AXIS_LABELS[d.axis])
        .join('·');
    const traits = tendency.traits.slice(0, 3).join('·');
    if (axes === '' || traits === '') return undefined;
    return `${axes} 쪽 성향이 두드러지고, ${traits} 성격이 밴다.`;
}

function resolveBranchId(
    officer: DialogueOfficer | null | undefined,
    keyword: string,
    tendency: OfficerTendency | undefined,
): string {
    // 1) 명시적 키워드가 항상 최우선 — 성향이 무엇이든 이긴다.
    const normalized = normalizeKeyword(keyword);
    for (const [pattern, branch] of KEYWORD_ALIASES) {
        if (pattern.test(normalized)) return branch;
    }

    // 2) 성향(trait) 기반 분기 — 8축 벡터만 사용한다(stats 비교 없음).
    const fromTendency = tendency ? branchIdFromTendency(tendency) : undefined;
    if (fromTendency) return fromTendency;

    // 3) 성향이 없으면 기존 personality 폴백 — 하위 호환 동작을 그대로 지킨다.
    const personality = normalizeKeyword(officer?.personality ?? '');
    if (/温柔|溫柔|온화|kind|benevolent|仁/i.test(personality)) return 'personal';
    if (/武勇|武猛|勇|무자|brave|剛|剛毅/i.test(personality)) return 'military';
    if (/智|知|지력|intellect|聪明|聰明/i.test(personality)) return 'strategy';
    return 'default';
}

function buildBranch(
    branchId: string,
    officerName: string,
    affinity: number,
    framing: string | undefined,
): ConversationBranch {
    const affinityText = affinity >= 40
        ? `${officerName}는 주공을 믿고 이미 마음을 열고 있다.`
        : affinity <= -30
            ? `${officerName}는 주공의 결정을 경계하며 거리를 두려 한다.`
            : `${officerName}는 주공의 평소 태도를 가만히 지켜보고 있다.`;

    // 성향 프레이밍이 있으면 이어 붙이고, 없으면 원래 문장을 그대로 만든다.
    const opening = framing ? `${affinityText} ${framing}` : affinityText;

    switch (branchId) {
        case 'military':
            return {
                id: 'military', title: `${officerName}와 전술을 논하다`, speaker: officerName,
                text: `${opening} “요즘 병사들의 상태가 마음에 걸립니다. 주공은 어떤 작전을 선호하십니까?”`,
                choices: [
                    { id: 'offense', label: '적진이 움직일 때까지 기다린다', description: '안정적이지만 기회를 놓칠 수 있다 · 우호도 +2', affinityDelta: 2 },
                    { id: 'attack', label: '먼저 병력을 움직인다', description: '위험을 감수하고 유리한 속도를 얻는다 · 우호도 +3', affinityDelta: 3 },
                ],
            };
        case 'domestic':
            return {
                id: 'domestic', title: `${officerName}와 내정을 의논하다`, speaker: officerName,
                text: `${opening} “백성들이 먹고살 수 있어야 군심도 바로섭니다. 주공은 다음 달 무엇을 우선하겠습니까?”`,
                choices: [
                    { id: 'relief', label: '민심을 먼저 살핀다', description: '치안과 식량에 투자 · 우호도 +4', affinityDelta: 4 },
                    { id: 'army', label: '군사 준비를 우선한다', description: '전투력을 높이지만 민심 부담이 커진다 · 우호도 +1', affinityDelta: 1 },
                ],
            };
        case 'diplomacy':
            return {
                id: 'diplomacy', title: `${officerName}의 diplomacy를 듣다`, speaker: officerName,
                text: `${opening} “다른 세력의 속내를 읽는 것이 우리를 살릴 겁니다. 먼저 손을 내밀까요?”`,
                choices: [
                    { id: 'probe', label: '예의와 선의로 탐색한다', description: '시간이 걸리지만 배신 위험이 낮다 · 우호도 +4', affinityDelta: 4 },
                    { id: 'pressure', label: '강한 말로 압박한다', description: '결과는 빠르지만 적대를 부를 수 있다 · 우호도 +2', affinityDelta: 2 },
                ],
            };
        case 'strategy':
            return {
                id: 'strategy', title: `${officerName}의 병법을 들려보다`, speaker: officerName,
                text: `${opening} “겉은 평범한 작전이지만, 목적은 적의 심리를 흔드는 것입니다. 주공은 이 계략을 어떻게 보십니까?”`,
                choices: [
                    { id: 'deception', label: '속임수를 그대로 실행한다', description: '예상 밖의 결과를 노린다 · 우호도 +3', affinityDelta: 3 },
                    { id: 'refine', label: '책략을 더 정교하게 다듬는다', description: '위험은 줄지만 준비 기간이 늘어난다 · 우호도 +2', affinityDelta: 2 },
                ],
            };
        case 'personal':
            return {
                id: 'personal', title: `${officerName}의 과거를 묻다`, speaker: officerName,
                text: `${opening} “장기전을 겪을수록 오래된 인연도 함께 남습니다. 주공은 어떤 시간을 기억하십니까?”`,
                choices: [
                    { id: 'listen', label: '조용히 끝까지 듣는다', description: '상대의 마음을 헤아린다 · 우호도 +5', affinityDelta: 5 },
                    { id: 'advice', label: '앞으로의 충고를 묻는다', description: '앞으로의 운영 조언을 듣는다 · 우호도 +3', affinityDelta: 3 },
                ],
            };
        default:
            return {
                id: 'default', title: `${officerName}와 오늘의 계획을 나누다`, speaker: officerName,
                text: `${opening} “오늘은 어떤 임무를 맡기시겠습니까?”`,
                choices: [
                    { id: 'listen', label: '먼저 상대의 의견을 듣는다', description: '상대의 기질을 이해한다 · 우호도 +4', affinityDelta: 4 },
                    { id: 'assign', label: '중요한 임무를 맡긴다', description: '상대의 능력을 직접 확인한다 · 우호도 +3', affinityDelta: 3 },
                ],
            };
    }
}

/**
 * [90] 대화 분기 발생기.
 *
 * 키워드가 명시되면 그 주제를 우선하고, 없으면 무장 성향(8축 trait 벡터)을 쓴다.
 * 성향을 모르면 기존 personality 폴백 → default 순으로 내려간다.
 * UI에서 선택지를 렌더링할 수 있는 데이터로 반환하며, 이 객체 자체는 스토어를 변경하지 않는다.
 * 결정론이며 Math.random 을 쓰지 않는다.
 */
export class ConversationSystem {
    /**
     * @param officer  기존 호출은 `{ name, personality }` 만 넘겨도 된다(그대로 동작).
     *                 성향을 쓰려면 `id` 또는 `traits` 를 추가로 넘긴다.
     * @param keyword  명시 키워드 — 있으면 성향과 무관하게 이 분기가 이긴다.
     * @param affinity 우호도 — 첫 문장의 태도 표현에 쓰인다.
     * @param options  `includeTraitLine: true` 면 결과에 trait 요약 줄을 채운다.
     */
    public getDialogueBranch(
        officer: DialogueOfficer | null | undefined,
        keyword: string,
        affinity = 0,
        options?: DialogueOptions,
    ): ConversationBranch {
        const tendency = resolveTendency(officer);
        const branchId = resolveBranchId(officer, keyword, tendency);
        const officerName = officer?.name ?? '상대';
        const branch = buildBranch(branchId, officerName, affinity, buildFraming(tendency));
        if (options?.includeTraitLine && tendency) {
            return { ...branch, traitLine: describeTendency(tendency) };
        }
        return branch;
    }

    /**
     * 성향 요약 한 줄(`describeTendency` 출력)만 필요할 때 — UI 에 성향 칸을 따로 그릴 때 쓴다.
     * 성향 정보를 모르면 undefined 를 준다(호출자가 빈칸으로 처리).
     */
    public getTraitLine(officer: DialogueOfficer | null | undefined): string | undefined {
        const tendency = resolveTendency(officer);
        return tendency ? describeTendency(tendency) : undefined;
    }
}
