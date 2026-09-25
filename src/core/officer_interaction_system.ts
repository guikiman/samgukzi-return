/**
 * 무장 상호작용 시스템 [24] 대화/증정, [32] 단기접전, [33] 설전, [C-인간관계] 우호도
 *
 * 무장 상세 패널에서 선택한 상호작용을 처리한다:
 *  - 대화(CHAT): 무료, 소액 우호도 상승. 월 1회 제한(같은 대상).
 *  - 증정(GIFT): 200金 소모, 우호도 큰 폭 상승.
 *  - 설전(DEBATE): DebateMinigame 엔진 기반 승부 → 승리 시 우호도 상승 + 약간의 평판 효과.
 *  - 일기토(DUEL): DuelMinigame 엔진 기반 승부 → 승리 시 경외, 패배 시 굴욕 (우호도 변동 작음).
 *
 * 모든 상호작용은 InteractionRingBuffer에 이력을 기록하고,
 * 관계 엣지(affinity)는 양방향으로 동기화한다. (applyRecruitFailure와 동일 패턴)
 * 결과는 계산(applyInteraction)과 실행(executeInteraction)으로 분리해 테스트 용이성 확보.
 */

import type { GameStore } from './game_store.js';
import type { Officer, OfficerStats } from './types.js';
import { DuelMinigame, type DuelState, type DuelCardType } from './duel_minigame.js';
import { DebateMinigame, type DebateState, type DebateCardType } from './debate_minigame.js';

export type InteractionKind = 'CHAT' | 'GIFT' | 'DEBATE' | 'DUEL';

/** 증정 비용 기본값 (金) — 구버전 호출과 증정 버튼의 기본 수량 */
export const GIFT_COST = 200;

export type GiftItemId = 'NONE' | 'SILK' | 'JADE' | 'BOOK' | 'TREASURE';
export type GiftItemGrade = 'NONE' | 'COMMON' | 'FINE' | 'RARE' | 'LEGENDARY';

export interface GiftItemDefinition {
    readonly id: GiftItemId;
    readonly name: string;
    readonly grade: GiftItemGrade;
    readonly gradeLabel: string;
    readonly affinity: number;
    readonly description: string;
}

/** 선물 아이템 등급과 아이템 자체 우호도 효과 [24][C-인간관계] */
export const GIFT_ITEMS: Record<GiftItemId, GiftItemDefinition> = {
    NONE: { id: 'NONE', name: '아이템 없음', grade: 'NONE', gradeLabel: '없음', affinity: 0, description: '금화만 보냅니다.' },
    SILK: { id: 'SILK', name: '비단', grade: 'COMMON', gradeLabel: '보통', affinity: 2, description: '실용적인 비단 선물' },
    BOOK: { id: 'BOOK', name: '병서', grade: 'FINE', gradeLabel: '고급', affinity: 5, description: '지식과 성의의象征' },
    JADE: { id: 'JADE', name: '옥비', grade: 'RARE', gradeLabel: '희귀', affinity: 9, description: '품격 높은 옥制成的 선물' },
    TREASURE: { id: 'TREASURE', name: '보물', grade: 'LEGENDARY', gradeLabel: '전설', affinity: 15, description: '가치 극히 높은 왕실 선물' },
};

export interface GiftOptions {
    readonly itemId?: GiftItemId;
    readonly gold?: number;
}

/** 금화 100金당 우호도 +1, 최대 +30. 아이템 효과는 별도로 더한다. */
export function calculateGiftAffinity(options: GiftOptions = {}): number {
    const item = GIFT_ITEMS[options.itemId ?? 'NONE'] ?? GIFT_ITEMS.NONE;
    const gold = Math.max(0, Math.floor(options.gold ?? GIFT_COST));
    return item.affinity + Math.min(30, Math.floor(gold / 100));
}

/** 같은 대상과의 대화 월 1회 제한 */
export const CHAT_MONTHLY_LIMIT = 1;

/** 상호작용별 우호도 변화 기본값 */
export const AFFINITY_DELTAS = {
    CHAT: +4,
    GIFT: +12,
    DEBATE_WIN: +8,
    DEBATE_LOSE: -3,
    DUEL_WIN: +5,      // 패배를 인정하고 경외
    DUEL_LOSE: +2,     // 승자도 존중하게 됨
} as const;

/** 상호작용 결과 요약 */
export interface InteractionOutcome {
    readonly kind: InteractionKind;
    readonly actorId: string;
    readonly targetId: string;
    readonly success: boolean;
    /** 적용된 우호도 변화량 */
    readonly affinityDelta: number;
    /** 소모된 금액 */
    readonly goldCost: number;
    /** 게임 로그용 메시지 */
    readonly message: string;
}

/** 상호작용 가능 여부 판정 (사이드 이펙트 없음) */
export function checkInteraction(
    store: GameStore,
    actorId: string,
    targetId: string,
    kind: InteractionKind,
    options: GiftOptions = {},
): { ok: boolean; reason?: string } {
    if (actorId === targetId) return { ok: false, reason: '자기 자신과는 상호작용할 수 없습니다.' };
    const actor = store.getOfficer(actorId);
    const target = store.getOfficer(targetId);
    if (!actor) return { ok: false, reason: '초빙자(행동 무장)를 찾을 수 없습니다.' };
    if (!target) return { ok: false, reason: '대상 무장을 찾을 수 없습니다.' };

    if (kind === 'GIFT') {
        const faction = actor.factionId ? store.getFaction(actor.factionId) : null;
        if (!faction) return { ok: false, reason: '소속 세력이 없어 증정할 수 없습니다.' };
        const customGift = options.itemId !== undefined || options.gold !== undefined;
        const requestedGold = options.gold ?? (customGift ? 0 : GIFT_COST);
        if (!Number.isFinite(requestedGold) || !Number.isInteger(requestedGold) || requestedGold < 0) {
            return { ok: false, reason: '금화 수량은 0 이상의 정수여야 합니다.' };
        }
        const gold = customGift ? requestedGold : GIFT_COST;
        if (faction.gold < gold) return { ok: false, reason: `국고가 부족합니다 (증정 비용 ${gold}金).` };
    }

    if (kind === 'CHAT') {
        const { year, month } = store.getGlobalState().time;
        // actorId 관점 엣지 조회 (스토어 인덱스는 source 기준 방향성을 가짐)
        const edge = store.getRelationships(actorId).find(e => e.target === targetId);
        const chattedThisMonth = edge?.history.some(h => h.year === year && h.month === month && h.event === 'CHAT') ?? false;
        if (chattedThisMonth) return { ok: false, reason: '이번 달에는 이미 대화했습니다 (월 1회).' };
    }

    return { ok: true };
}

/**
 * 우호도 적용 (양방향 + 이력 기록).
 * 스토어의 addRelationship은 역방향 사본을 인덱스에 자동 추가하므로,
 * 엣지 생성 후 양방향 사본을 다시 조회해 함께 갱신한다 (applyRecruitFailure 동일 패턴).
 */
function applyAffinity(
    store: GameStore,
    actorId: string,
    targetId: string,
    delta: number,
    event: string,
): void {
    const { year, month } = store.getGlobalState().time;
    let forward = store.getRelationships(actorId).find(e => e.target === targetId);
    let reverse = store.getRelationships(targetId).find(e => e.target === actorId);

    if (!forward && !reverse) {
        store.addRelationship({
            source: actorId,
            target: targetId,
            type: 'FRIEND',
            affinity: 0,
            history: [],
        });
        forward = store.getRelationships(actorId).find(e => e.target === targetId);
        reverse = store.getRelationships(targetId).find(e => e.target === actorId);
    }

    for (const edge of [forward, reverse]) {
        if (!edge) continue;
        edge.affinity = Math.max(-100, Math.min(100, edge.affinity + delta));
        edge.history.push({ year, month, event, delta });
    }
}

/** InteractionRingBuffer에 이력 기록 (선택적 — store에 버퍼가 있을 때) */
function recordInteractionHistory(
    store: GameStore,
    actor: Officer,
    target: Officer,
    kind: InteractionKind,
    affinityDelta: number,
): void {
    const buffer = (store as unknown as { interactionHistory?: { push(r: unknown): unknown } }).interactionHistory;
    if (!buffer) return;
    const { year, month } = store.getGlobalState().time;
    buffer.push({
        sourceId: actor.id,
        targetId: target.id,
        type: kind,
        affinityDelta,
        turn: store.getGlobalState().turnCount,
        year,
        month,
        description: `${actor.name} → ${target.name} (${kind})`,
    });
}

/**
 * 상호작용 실행 — 판정 → 우호도/자금 적용 → 이력 기록.
 * DEBATE/DUEL은 미니게임 엔진을 사용한 즉시 시뮬레이션 (카드 자동 선택).
 */
export function executeInteraction(
    store: GameStore,
    actorId: string,
    targetId: string,
    kind: InteractionKind,
    options: GiftOptions = {},
): InteractionOutcome {
    const gate = checkInteraction(store, actorId, targetId, kind, options);
    if (!gate.ok) {
        return {
            kind, actorId, targetId,
            success: false, affinityDelta: 0, goldCost: 0,
            message: gate.reason ?? '상호작용할 수 없습니다.',
        };
    }

    const actor = store.getOfficer(actorId)!;
    const target = store.getOfficer(targetId)!;
    const { year, month } = store.getGlobalState().time;

    let affinityDelta = 0;
    let goldCost = 0;
    let message = '';
    let event = kind;

    switch (kind) {
        case 'CHAT': {
            affinityDelta = AFFINITY_DELTAS.CHAT;
            message = `💬 ${actor.name}이(가) ${target.name}과(와) 대화했습니다. (우호도 +${affinityDelta})`;
            break;
        }
        case 'GIFT': {
            const itemId = options.itemId ?? 'NONE';
            const item = GIFT_ITEMS[itemId] ?? GIFT_ITEMS.NONE;
            const customGift = options.itemId !== undefined || options.gold !== undefined;
            const requestedGold = options.gold ?? (customGift ? 0 : GIFT_COST);
            goldCost = requestedGold;
            const faction = store.getFaction(actor.factionId!)!;
            store.updateFaction(faction.id, { gold: faction.gold - goldCost });
            affinityDelta = customGift ? calculateGiftAffinity(options) : AFFINITY_DELTAS.GIFT;
            const itemText = itemId === 'NONE' ? '아이템 없음' : `${item.name}(${item.gradeLabel})`;
            message = `🎁 ${actor.name}이(가) ${target.name}에게 선물을 보냈습니다. (${itemText}, −${goldCost}金, 우호도 +${affinityDelta})`;
            break;
        }
        case 'DEBATE': {
            event = 'DEBATE';
            const debate = new DebateMinigame();
            debate.startDebate(actor.id, target.id, actor.stats, target.stats);
            let state: DebateState = debate.getState();
            // 자동 플레이: 가능한 카드 중 무작위 선택
            while (!debate.isDebateOver()) {
                const cards = debate.getAvailableCards(state.playerSpirit, state.playerMood);
                const pick = cards[Math.floor(Math.random() * cards.length)]?.type ?? 'LOGIC';
                state = debate.playCard(pick as DebateCardType);
            }
            const result = debate.getDebateResult();
            if (result.winner === actor.id) {
                affinityDelta = AFFINITY_DELTAS.DEBATE_WIN;
                message = `🎙️ ${actor.name}이(가) ${target.name}과(와) 설전에서 승리! (우호도 +${affinityDelta})`;
            } else if (result.winner === target.id) {
                affinityDelta = AFFINITY_DELTAS.DEBATE_LOSE;
                message = `🎙️ ${actor.name}이(가) ${target.name}과(와) 설전에서 패배했습니다. (우호도 ${affinityDelta})`;
            } else {
                affinityDelta = 0;
                message = `🎙️ ${actor.name}과(와) ${target.name}의 설전은 무승부로 끝났습니다.`;
            }
            break;
        }
        case 'DUEL': {
            event = 'DUEL';
            const duel = new DuelMinigame();
            duel.startDuel(actor.id, target.id, actor.stats, target.stats);
            let state: DuelState = duel.getState();
            while (!duel.isDuelOver()) {
                const cards = duel.getAvailableCards(state.playerSpirit);
                const pick = cards[Math.floor(Math.random() * cards.length)]?.type ?? 'SLASH';
                state = duel.playCard(pick as DuelCardType);
            }
            const winner = duel.getWinner();
            if (winner === actor.id) {
                affinityDelta = AFFINITY_DELTAS.DUEL_WIN;
                message = `⚔️ ${actor.name}이(가) ${target.name}과(와) 일기토에서 승리! (우호도 +${affinityDelta})`;
            } else if (winner === target.id) {
                affinityDelta = AFFINITY_DELTAS.DUEL_LOSE;
                message = `⚔️ ${actor.name}이(가) ${target.name}과(와) 일기토에서 패배했습니다. (우호도 +${affinityDelta})`;
            } else {
                affinityDelta = 0;
                message = `⚔️ ${actor.name}과(와) ${target.name}의 일기토는 무승부였습니다.`;
            }
            break;
        }
    }

    if (affinityDelta !== 0) {
        applyAffinity(store, actorId, targetId, affinityDelta, event);
    }
    recordInteractionHistory(store, actor, target, kind, affinityDelta);

    return { kind, actorId, targetId, success: true, affinityDelta, goldCost, message };
}

/** 대상 무장과의 현재 우호도 조회 (엣지 없으면 0) */
export function getAffinityBetween(store: GameStore, aId: string, bId: string): number {
    const forward = store.getRelationships(aId).find(e => e.target === bId);
    if (forward) return forward.affinity;
    const reverse = store.getRelationships(bId).find(e => e.target === aId);
    if (reverse) return reverse.affinity;
    return 0;
}
