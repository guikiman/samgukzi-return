import type { Officer } from './types.js';

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
}

type DialogueOfficer = Pick<Officer, 'name' | 'personality'>;

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

function resolveBranchId(officer: DialogueOfficer | null | undefined, keyword: string): string {
    const normalized = normalizeKeyword(keyword);
    for (const [pattern, branch] of KEYWORD_ALIASES) {
        if (pattern.test(normalized)) return branch;
    }

    const personality = normalizeKeyword(officer?.personality ?? '');
    if (/温柔|溫柔|온화|kind|benevolent|仁/i.test(personality)) return 'personal';
    if (/武勇|武猛|勇|무자|brave|剛|剛毅/i.test(personality)) return 'military';
    if (/智|知|지력|intellect|聪明|聰明/i.test(personality)) return 'strategy';
    return 'default';
}

function buildBranch(branchId: string, officerName: string, affinity: number): ConversationBranch {
    const affinityText = affinity >= 40
        ? `${officerName}는 주공을 믿고 이미 마음을 열고 있다.`
        : affinity <= -30
            ? `${officerName}는 주공의 결정을 경계하며 거리를 두려 한다.`
            : `${officerName}는 주공의 평소 태도를 가만히 지켜보고 있다.`;

    switch (branchId) {
        case 'military':
            return {
                id: 'military', title: `${officerName}와 전술을 논하다`, speaker: officerName,
                text: `${affinityText} “요즘 병사들의 상태가 마음에 걸립니다. 주공은 어떤 작전을 선호하십니까?”`,
                choices: [
                    { id: 'offense', label: '적진이 움직일 때까지 기다린다', description: '안정적이지만 기회를 놓칠 수 있다 · 우호도 +2', affinityDelta: 2 },
                    { id: 'attack', label: '먼저 병력을 움직인다', description: '위험을 감수하고 유리한 속도를 얻는다 · 우호도 +3', affinityDelta: 3 },
                ],
            };
        case 'domestic':
            return {
                id: 'domestic', title: `${officerName}와 내정을 의논하다`, speaker: officerName,
                text: `${affinityText} “백성들이 먹고살 수 있어야 군심도 바로섭니다. 주공은 다음 달 무엇을 우선하겠습니까?”`,
                choices: [
                    { id: 'relief', label: '민심을 먼저 살핀다', description: '치안과 식량에 투자 · 우호도 +4', affinityDelta: 4 },
                    { id: 'army', label: '군사 준비를 우선한다', description: '전투력을 높이지만 민심 부담이 커진다 · 우호도 +1', affinityDelta: 1 },
                ],
            };
        case 'diplomacy':
            return {
                id: 'diplomacy', title: `${officerName}의 diplomacy를 듣다`, speaker: officerName,
                text: `${affinityText} “다른 세력의 속내를 읽는 것이 우리를 살릴 겁니다. 먼저 손을 내밀까요?”`,
                choices: [
                    { id: 'probe', label: '예의와 선의로 탐색한다', description: '시간이 걸리지만 배신 위험이 낮다 · 우호도 +4', affinityDelta: 4 },
                    { id: 'pressure', label: '강한 말로 압박한다', description: '결과는 빠르지만 적대를 부를 수 있다 · 우호도 +2', affinityDelta: 2 },
                ],
            };
        case 'strategy':
            return {
                id: 'strategy', title: `${officerName}의 병법을 들려보다`, speaker: officerName,
                text: `${affinityText} “겉은 평범한 작전이지만, 목적은 적의 심리를 흔드는 것입니다. 주공은 이 계략을 어떻게 보십니까?”`,
                choices: [
                    { id: 'deception', label: '속임수를 그대로 실행한다', description: '예상 밖의 결과를 노린다 · 우호도 +3', affinityDelta: 3 },
                    { id: 'refine', label: '책략을 더 정교하게 다듬는다', description: '위험은 줄지만 준비 기간이 늘어난다 · 우호도 +2', affinityDelta: 2 },
                ],
            };
        case 'personal':
            return {
                id: 'personal', title: `${officerName}의 과거를 묻다`, speaker: officerName,
                text: `${affinityText} “장기전을 겪을수록 오래된 인연도 함께 남습니다. 주공은 어떤 시간을 기억하십니까?”`,
                choices: [
                    { id: 'listen', label: '조용히 끝까지 듣는다', description: '상대의 마음을 헤아린다 · 우호도 +5', affinityDelta: 5 },
                    { id: 'advice', label: '앞으로의 충고를 묻는다', description: '앞으로의 운영 조언을 듣는다 · 우호도 +3', affinityDelta: 3 },
                ],
            };
        default:
            return {
                id: 'default', title: `${officerName}와 오늘의 계획을 나누다`, speaker: officerName,
                text: `${affinityText} “오늘은 어떤 임무를 맡기시겠습니까?”`,
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
 * 키워드가 명시되면 그 주제를 우선하고, 없으면 무장 성향과 관계 수치를 사용한다.
 * UI에서 선택지를 렌더링할 수 있는 데이터로 반환하며, 이 객체 자체는 스토어를 변경하지 않는다.
 */
export class ConversationSystem {
    public getDialogueBranch(
        officer: DialogueOfficer | null | undefined,
        keyword: string,
        affinity = 0,
    ): ConversationBranch {
        const branchId = resolveBranchId(officer, keyword);
        return buildBranch(branchId, officer?.name ?? '상대', affinity);
    }
}
