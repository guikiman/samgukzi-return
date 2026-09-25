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
export type InteractionKind = 'CHAT' | 'GIFT' | 'DEBATE' | 'DUEL';
/** 증정 비용 기본값 (金) — 구버전 호출과 증정 버튼의 기본 수량 */
export declare const GIFT_COST = 200;
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
export declare const GIFT_ITEMS: Record<GiftItemId, GiftItemDefinition>;
export interface GiftOptions {
    readonly itemId?: GiftItemId;
    readonly gold?: number;
}
/** 금화 100金당 우호도 +1, 최대 +30. 아이템 효과는 별도로 더한다. */
export declare function calculateGiftAffinity(options?: GiftOptions): number;
/** 같은 대상과의 대화 월 1회 제한 */
export declare const CHAT_MONTHLY_LIMIT = 1;
/** 상호작용별 우호도 변화 기본값 */
export declare const AFFINITY_DELTAS: {
    readonly CHAT: 4;
    readonly GIFT: 12;
    readonly DEBATE_WIN: 8;
    readonly DEBATE_LOSE: -3;
    readonly DUEL_WIN: 5;
    readonly DUEL_LOSE: 2;
};
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
export declare function checkInteraction(store: GameStore, actorId: string, targetId: string, kind: InteractionKind, options?: GiftOptions): {
    ok: boolean;
    reason?: string;
};
/**
 * 상호작용 실행 — 판정 → 우호도/자금 적용 → 이력 기록.
 * DEBATE/DUEL은 미니게임 엔진을 사용한 즉시 시뮬레이션 (카드 자동 선택).
 */
export declare function executeInteraction(store: GameStore, actorId: string, targetId: string, kind: InteractionKind, options?: GiftOptions): InteractionOutcome;
/** 대상 무장과의 현재 우호도 조회 (엣지 없으면 0) */
export declare function getAffinityBetween(store: GameStore, aId: string, bId: string): number;
//# sourceMappingURL=officer_interaction_system.d.ts.map