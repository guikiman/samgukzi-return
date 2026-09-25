/**
 * [차별화] 장수 개성(trait) 기반 행동 성향 추론.
 *
 * 기존 대화/AI 는 8단계 Personality 와 3줄짜리 템플릿에만 의존해 장수 개성이看不出来.
 * 삼국지14PK 의 개성 158종은 각자 실제 효과 문구를 갖는다. 이 모듈은 그 효과에서
 * 파생되는 행동 축을 뽑아 장수마다 다른 성향 벡터를 만든다.
 *
 * 축(axis)은 게임플레이 효과를 읽어 대응시킨 것이다. 추측이 아니라 효과 문구 대응이다.
 * 결정적(deterministic)이며 Math.random 을 쓰지 않는다 — 같은 장수는 항상 같은 성향.
 */

import { OFFICER_PROFILES, type OfficerProfile } from './officer_profile_schema';
import type { OfficerID } from './types';

export const DIFFERENTIATION_AXES = [
    'aggression',
    'resolve',
    'cunning',
    'administration',
    'social',
    'greed',
    'mercy',
    'recklessness',
] as const;
export type DifferentiationAxis = (typeof DIFFERENTIATION_AXES)[number];

export type TendencyVector = Record<DifferentiationAxis, number>;

export const AXIS_LABELS: Readonly<Record<DifferentiationAxis, string>> = {
    aggression: '공격성',
    resolve: '투지',
    cunning: '책략',
    administration: '행정',
    social: '인맥',
    greed: '탐욕',
    mercy: '자비',
    recklessness: '무모',
};

/** trait -> 축 가중치. 부호는 방향, 절댓값은 해당 축과의 강도. */
const TRAIT_AXES: Readonly<Record<string, Partial<Record<DifferentiationAxis, number>>>> = {
    // 적에게 직접 부딪히는 축
    저돌: { aggression: 3, recklessness: 3 },
    난폭: { aggression: 3, mercy: -3, recklessness: 2 },
    맹자: { aggression: 2 },
    살상: { aggression: 1 },
    위풍: { aggression: 2 },
    묘산: { cunning: 1, aggression: 1 },
    기략: { cunning: 2 },
    궤계: { cunning: 2 },
    모략: { cunning: 2 },
    포박: { aggression: 1 },
    단기: { aggression: 3 },
    호걸: { aggression: 2 },
    투장: { aggression: 1, resolve: 2 },
    오만: { aggression: 1, recklessness: 2 },
    공명: { aggression: 2, recklessness: 2 },
    강탈: { greed: 3, aggression: 1 },
    소침: { resolve: -2 },
    // 버티는 축
    강건: { resolve: 2, mercy: 1 },
    불굴: { resolve: 3 },
    일심: { resolve: 2 },
    장구: { resolve: 2 },
    담력: { resolve: 2 },
    구심: { resolve: 1, social: 1 },
    후위: { resolve: 2 },
    견수: { resolve: 2 },
    강장: { resolve: 1, mercy: 1 },
    금강: { resolve: 3 },
    강운: { resolve: 3 },
    확삭: { resolve: 3 },
    태연: { resolve: 2 },
    규율: { resolve: 1, mercy: 1 },
    선비: { resolve: 1, mercy: 2 },
    호위: { resolve: 1, mercy: 2 },
    // 계략/정보 축
    책사: { cunning: 3 },
    간파: { cunning: 2 },
    교사: { cunning: 2 },
    신중: { cunning: 2, recklessness: -2 },
    화공: { cunning: 2 },
    발명: { cunning: 2 },
    해제: { cunning: 2 },
    함정: { cunning: 2 },
    감지: { cunning: 1 },
    점술: { cunning: 1 },
    석병: { cunning: 2 },
    // 행정/정치 축
    능리: { administration: 3 },
    교화: { administration: 2, mercy: 1 },
    진흥: { administration: 2 },
    문화: { administration: 2 },
    법률: { administration: 3 },
    징세: { administration: 2, greed: 1 },
    농정: { administration: 3 },
    수납: { administration: 2 },
    절약: { administration: 2 },
    절감: { administration: 2 },
    부호: { administration: 1, greed: 2 },
    미도: { administration: 2 },
    조달: { administration: 2 },
    주석: { administration: 2 },
    왕좌: { administration: 2 },
    사관: { administration: 1 },
    학자: { cunning: 1, administration: 1 },
    친강: { administration: 1, mercy: 1 },
    친오: { administration: 1, mercy: 1 },
    친만: { administration: 1, mercy: 1 },
    친월: { administration: 1, mercy: 1 },
    친선: { administration: 1, mercy: 1 },
    // 인맥/외교 축
    인맥: { social: 3 },
    안목: { social: 2, cunning: 1 },
    논객: { social: 3 },
    특사: { social: 3 },
    보좌: { social: 2 },
    동지: { social: 2 },
    지낭: { social: 2 },
    독려: { social: 2, mercy: 1 },
    명경: { social: 1 },
    응원: { social: 2, mercy: 1 },
    악주: { social: -2 },
    // 탐욕/야망 축
    탐욕: { greed: 3 },
    소욕: { greed: 2 },
    명성: { greed: 2, social: 1 },
    낭비: { greed: 2 },
    // 자비/온유 축
    자비: { mercy: 3, aggression: -2 },
    위무: { mercy: 2 },
    인정: { mercy: 2, resolve: 1 },
    혈로: { mercy: 1, social: 1 },
    // 위험/무모 축
    나약: { recklessness: 2, resolve: -2 },
    허약: { recklessness: 2, resolve: -2 },
    직정: { recklessness: 2 },
    소심: { recklessness: 2, aggression: -1, resolve: -1 },
    경망: { recklessness: 1, resolve: 1 },
    적도: { greed: 2, mercy: -2 },
    주란: { resolve: -2 },
    동요: { resolve: -2 },
    우유: { resolve: -1, aggression: -1 },
};

const UNMAPPED = new Set(Object.keys(TRAIT_AXES));

export function mappedTraitNames(): string[] {
    return Object.keys(TRAIT_AXES);
}

export function unmappedTraitsInUse(): string[] {
    const used = new Set<string>();
    for (const p of OFFICER_PROFILES.all()) for (const t of p.traits) used.add(t);
    return [...used].filter(t => !UNMAPPED.has(t)).sort();
}

function zeroVector(): TendencyVector {
    return {
        aggression: 0, resolve: 0, cunning: 0, administration: 0,
        social: 0, greed: 0, mercy: 0, recklessness: 0,
    };
}

/** trait 목록을 축 점수로 환산한다. 매핑되지 않은 trait 는 무시한다. */
export function accumulateTraits(traits: readonly string[]): TendencyVector {
    const v = zeroVector();
    for (const t of traits) {
        const axes = TRAIT_AXES[t];
        if (!axes) continue;
        for (const axis of DIFFERENTIATION_AXES) {
            v[axis] += axes[axis] ?? 0;
        }
    }
    return v;
}

/** 축 벡터를 0..100 으로 정규화한다. 최대 절대값을 기준으로 스케일한다. */
export function normalizeTendency(v: TendencyVector): TendencyVector {
    let max = 0;
    for (const a of DIFFERENTIATION_AXES) max = Math.max(max, Math.abs(v[a]));
    if (max === 0) return zeroVector();
    const out = zeroVector();
    for (const a of DIFFERENTIATION_AXES) {
        out[a] = Math.round(((v[a] + max) / (2 * max)) * 100);
    }
    return out;
}

export interface OfficerTendency {
    id: OfficerID;
    name: string;
    raw: TendencyVector;
    normalized: TendencyVector;
    dominant: Array<{ axis: DifferentiationAxis; value: number }>;
    traits: string[];
}

export function getOfficerTendency(id: OfficerID): OfficerTendency | undefined {
    const p = OFFICER_PROFILES.get(id);
    return p ? buildTendency(p) : undefined;
}

export function buildTendency(p: OfficerProfile): OfficerTendency {
    const raw = accumulateTraits(p.traits);
    const normalized = normalizeTendency(raw);
    const dominant = DIFFERENTIATION_AXES
        .map(axis => ({ axis, value: raw[axis] }))
        .filter(x => x.value !== 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 3);
    return { id: p.id, name: p.name, raw, normalized, dominant, traits: p.traits };
}

/** 성향을 한국어 서술로 바꾼다. 대사/UI 확장에 쓴다. */
export function describeTendency(t: OfficerTendency): string {
    if (t.dominant.length === 0) return `${t.name}는 아직 알려진 성향이 적다.`;
    const parts = t.dominant
        .slice(0, 2)
        .map(d => `${AXIS_LABELS[d.axis]} ${d.value >= 0 ? '강함' : '부족'}`);
    return `${t.name}는 ${parts.join(', ')} — ${t.traits.slice(0, 3).join('·')} 성격.`;
}

export function allTendencies(): OfficerTendency[] {
    return OFFICER_PROFILES.all().map(buildTendency);
}
