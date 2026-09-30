/**
 * 대화 문장 조립기 — 짧고 건조한 문장으로 대사를 만든다.
 *
 * 왜 별도 모듈인가:
 * - 기존 conversation_system 은 branch 별로 문장이 하나씩 박혀 있어서
 *   같은 무장과 같은 화제면 늘 같은 말을 한다.
 * - 여기서는 문장을 '결(affinity)' 과 '화제(topic)' 로 조립한다.
 *
 * 규칙:
 * - 결정론. 같은 입력에는 같은 문장. 랜덤을 쓰지 않는다.
 * - 2~3문장. 긴 독백은 피한다.
 * - 존댓말과 낮은말을 섞지 않는다.
 */

export type DialogueTopic =
    | 'military' | 'strategy' | 'domestic' | 'diplomacy' | 'personal' | 'report';

/** 우호도 구간. 문장의 온도를 여기서 정한다. */
export type AffinityTier = 'hostile' | 'wary' | 'neutral' | 'trusting' | 'devoted';

export function affinityTier(affinity: number): AffinityTier {
    if (affinity <= -40) return 'hostile';
    if (affinity <= -10) return 'wary';
    if (affinity < 30) return 'neutral';
    if (affinity < 70) return 'trusting';
    return 'devoted';
}

export interface SpeakerProfile {
    name: string;
    /** 성향/특성 한 줄. 있으면 화제 문장에 덧붙인다. */
    traitLine?: string;
    factionName?: string;
    rank?: string;
}

export interface DialogueContext {
    speaker: SpeakerProfile;
    listener: SpeakerProfile;
    topic: DialogueTopic;
    affinity: number;
    year?: number;
    month?: number;
    /** 화제 관련 상태 한 줄. 예: '군사 · 병력 12,000' */
    stateLine?: string;
}

/** 결별 도입부 — 성격이 아니라 태도를 말한다. */
const OPENINGS: Record<AffinityTier, string[]> = {
    hostile: [
        '{L}의 눈이 날카롭다.',
        '잠시 침묵이 흐른다. {L}이 먼저 입을 연다.',
        '{L}은(는) 목소리를 낮췄다.',
    ],
    wary: [
        '{L}은(는) 말수를 삼킨다.',
        '{L}이 고개를 돌렸다가 다시 마주한다.',
        '잠깐 뜸을 들이더니 {L}이 입을 연다.',
    ],
    neutral: [
        '{L}이 무장 점검을 끝냈다.',
        '{L}이 손등의 문서를 말아 넣는다.',
        '{L}이 고개를 끄덕였다.',
    ],
    trusting: [
        '{L}이 먼저야, 온 지호로.',
        '{L}은(는) 주공을 향해 몸을 기울였다.',
        '{L}의 표정이 풀린다.',
    ],
    devoted: [
        '{L}이 눈을 감고 한숨을 쉬었다.',
        '{L}이 먼저 고개를 숙였다.',
        '{L}의 목소리에 망설임이 없다.',
    ],
};

/** 화제별 본문. */
const TOPIC_LINES: Record<DialogueTopic, string[]> = {
    military: [
        '“병사들이 무장 점검을 마쳤사옵니다. 출발의 날이 정해져야 하옵니다.”',
        '“적의 병력이 얼마인지를 아옵소서.”',
        '“지금 댁의 정예는 말이 필요 없습니다. 눈이 필요하지.”',
    ],
    strategy: [
        '“지금은 힘이 아니라 계략이 필요한 때옵니다.”',
        '“맺는 자는 풀보다 어렵사옵니다. 여는 자보다.”',
        '“적의 틈은 있으나, 우리 쪽 틈도 함께 막아야 하옵니다.”',
    ],
    domestic: [
        '“백성에게 굶주림이 오면 말은 통하지 않사옵니다.”',
        '“지금의 수레가 국고를 삼키고 있옵니다. 기름이 바닥이옵니다.”',
        '“농기(農器) 하나 바꾸면 논이 서옵니다.”',
    ],
    diplomacy: [
        '“생각을 바꿀 수는 있사옵니다. 다만 그대가 믿어야 하옵니다.”',
        '“검이 아니라 먹선(飮膳)이 문을 여옵니다.”',
        '“그를 위해서는 내가 먼저 손을 내밀어야 할지도 모르옵니다.”',
    ],
    personal: [
        '“사람은 계략보다 오래 삽니다. 그러니 조심하시옵소서.”',
        '“이 나이를 먹으니, 후배에게 할 말이 많사옵니다.”',
        '“하루가 흔들리면 다음이 없는 법이옵니다.”',
    ],
    report: [
        '“당장의 사정을 아옵니다. 이 기회에 펴야 할 것이 있사옵니다.”',
        '“방금 처리한 일과를 간략히 아뢰겠사옵니다.”',
        '“숫자부터 보입니다. 그다음에 판단을.”',
    ],
};

/** 마무리 — 결이 높을수록 요구가 구체적이다. */
const CLOSINGS: Record<AffinityTier, string[]> = {
    hostile: ['“주공의 답을 기다리겠사옵니다.”', '“묻지 않으셔도 되옵니다.”'],
    wary: ['“주공이 정하겠사옵니다.”', '“다만, 한 번 더 재고하시옵소서.”'],
    neutral: ['“어떻게 하시겠사옵니까?”', '“주공의 의견을 듣겠사옵니다.”'],
    trusting: ['“주공이 정하신 대로 하겠사옵니다.”', '“맡겨 주시면 맡겠사옵니다.”'],
    devoted: ['“주공의 명령이라면 곧 움직이겠사옵니다.”', '“어긋나지 않겠사옵니다.”'],
};

/** 성향 문장을 덧붙일 때 쓰는 연결. */
const TRAIT_LEADS = [
    '{S}의 성격상, 이 일은 자기가 떠안고 싶어 할 일이다.',
    '{S}라면 반드시 하고 싶은 말이 있다.',
    '성향대로, {S}는 다른 곳을 보지 않았다.',
];

/**
 * 한 문단을 만든다. 화면이 한 덩어리로 그릴 수 있게 문자열 하나로 돌려준다.
 */
export function composeDialogue(ctx: DialogueContext): string {
    const { speaker, listener, topic, affinity, year, month, stateLine } = ctx;
    const tier = affinityTier(affinity);

    // 결정론적 선택: 이름/연도/월로 시드. 같은 상황이면 같은 조합이 나온다.
    const seed = hash(`${speaker.name}|${listener.name}|${topic}|${year ?? ''}|${month ?? ''}`);
    const pick = <T,>(arr: readonly T[], salt: number): T => arr[(seed + salt * 2654435761) % arr.length];

    const fill = (tpl: string): string => tpl
        .replace(/\{L\}/g, listener.name)
        .replace(/\{S\}/g, speaker.name);

    const opening = fill(pick(OPENINGS[tier], 1));
    const parts: string[] = [opening, fill(pick(TOPIC_LINES[topic], 2))];

    // 화자 이름이 한 번도 안 나오면 '누가 말한 것인지' 읽을 수 없다.
    // 성향 줄이 이미 이름을 담고 있으면 그것으로 충분하다.
    if (!parts.some(p => p.includes(speaker.name))) {
        if (speaker.traitLine) {
            parts.push(fill(pick(TRAIT_LEADS, 3)));
        } else {
            parts.push(`— ${speaker.name}`);
        }
    } else if (speaker.traitLine) {
        // 성향 줄을 넣자마자 이름이 빠진다 — 화제와 이어지게 한 번 더 붙인다.
        parts.push(fill(pick(TRAIT_LEADS, 3)));
    }

    parts.push(fill(pick(CLOSINGS[tier], 4)));

    // 진행 시점과 상태는 '말'이 아니라 '참고'다.
    // 본문에 꿰지 않고 별도 줄로 떼어낸다 — 화면에서 정보칸으로 옮길 수 있게.
    const notes: string[] = [];
    if (year !== undefined) {
        notes.push(`기준: ${month !== undefined ? `${year}년 ${month}월` : `${year}년`}`);
    }
    if (stateLine) notes.push(stateLine);

    const text = parts.join('\n');
    return notes.length > 0 ? `${text}\n\n${notes.join(' / ')}` : text;
}

/**
 * 선택지 응답 — 누른 뒤 상대가 내놓는 한 마디.
 * 결과를 길게 설명하지 않는다. 한 줄이면 충분하다.
 */
export function composeResponse(
    choiceLabel: string,
    affinityBefore: number,
    affinityAfter: number,
    rngSeed: string,
): string {
    const delta = affinityAfter - affinityBefore;
    const seed = hash(rngSeed);
    const pick = <T,>(arr: readonly T[], salt: number): T => arr[(seed + salt * 40503) % arr.length];

    // 모든 반응형태가 선택지 라벨과 실제 결과를 함께 보여준다.
    // 여기가 '예상'이 아니라 '실제' 결과라서, 생략하면 플레이어가 결과를 모른다.
    const signed = `${delta > 0 ? `+${delta}` : delta}`;
    if (delta > 0) {
        return pick([
            `{CHOICE} — 잘 처리하겠사옵니다. (우호도 ${signed})`,
            `{CHOICE} — 그리하겠사옵니다. (우호도 ${signed})`,
            `{CHOICE} — 뜻이 잘 통하옵니다. (우호도 ${signed})`,
        ], 1).replace(/\{CHOICE\}/g, choiceLabel);
    }
    if (delta < 0) {
        return pick([
            `{CHOICE} — 시킨 대로 하겠사옵니다. (우호도 ${signed})`,
            `{CHOICE} — 잘 아옵니다만, 마음은 복잡하옵니다. (우호도 ${signed})`,
            `{CHOICE} — 아쉽사옵니다. (우호도 ${signed})`,
        ], 2).replace(/\{CHOICE\}/g, choiceLabel);
    }
    return pick([
        '{CHOICE} — 그대로 두옵니다.',
        '{CHOICE} — 명을 듣겠사옵니다.',
    ], 3).replace(/\{CHOICE\}/g, choiceLabel);
}

/** 서문용 해시 — FNV-1a. 결정론만 필요하므로 짧게 구현한다. */
function hash(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}
