/**
 * 시장 명령 패널 코어.
 *
 * 순수 함수만 둔다. UI·스토어 접근은 main.ts 의 openMarketCommandPanel 이 담당한다.
 * - 민심: 별도 수치 없이 충성·치안에서 유도한다 (표시 전용, 저장 불필요).
 * - 명령 1회 비용은 전부 令MARKET_ORDER_COST 로 균일하다.
 */

/** 명령 1회에 드는 행동력. */
export const MARKET_ORDER_COST = 20;

/** 민심 0~100 — 충성과 치안의 평균을 반올림한다. 범위를 벗어나면 자른다. */
export function marketMood(loyalty: number, publicOrder: number): number {
    const value = Math.round((loyalty + publicOrder) / 2);
    return Math.max(0, Math.min(100, value));
}

/** 0~100 을 10칸 막대로 그린다. */
export function moodBar(value: number, segments = 10): string {
    const filled = Math.max(0, Math.min(segments, Math.round((value / 100) * segments)));
    return '█'.repeat(filled) + '░'.repeat(segments - filled);
}

export interface MarketFigure {
    readonly name: string;
    readonly fame: number;
    readonly infamy: number;
}

/**
 * 소문 대상 — 악명이 가장 높은 자를 고른다.
 * 동점이면 rand 로 고른다. 후보가 없으면 null.
 */
export function pickRumorTarget(
    candidates: readonly MarketFigure[],
    rand: () => number = Math.random,
): MarketFigure | null {
    if (candidates.length === 0) return null;
    const top = Math.max(...candidates.map(c => c.infamy));
    const tied = candidates.filter(c => c.infamy === top);
    const pick = tied[Math.floor(rand() * tied.length)];
    return pick ?? tied[0] ?? null;
}

/** 견문 결과 한 줄. */
export function rumorLine(target: MarketFigure): string {
    return `${target.name}에 대한 소문 — 명성 ${target.fame}, 악명 ${target.infamy}. 뒷골목에서 이름이 오르내리고 있다.`;
}

export interface MarketTalent {
    readonly name: string;
    readonly bestLabel: string;
    readonly bestValue: number;
}

/** 재야 인재 — 후보 중 하나를 고른다. 없으면 null. */
export function pickTalent<T extends MarketTalent>(
    free: readonly T[],
    rand: () => number = Math.random,
): T | null {
    if (free.length === 0) return null;
    return free[Math.floor(rand() * free.length)] ?? null;
}

/** 인재 탐색 결과 한 줄. */
export function talentLine(found: MarketTalent | null): string {
    if (!found) return '장날인데도 눈에 띄는 인재가 없다. 다음 장을 기약한다.';
    return `${found.name} — ${found.bestLabel} ${found.bestValue}. 등용을 시도해 보시지.`;
}
