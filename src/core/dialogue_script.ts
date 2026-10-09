/**
 * 연쇄 대화 스크립트 — 단계별 선택 방식 [신규 기능]
 *
 * 왜 새 모듈인가:
 * - 기존 dialogue_composer 는 '문장 한 덩어리' 를 만든다.
 * - 이 모듈은 '선택지 -> 다른 대화 -> 다시 선택지' 로 이어지는 흐름을 만든다.
 *   시장 클릭 -> 불량배 사건 -> 선택 -> 처리 결과 -> 다시 선택.
 *
 * 설계:
 * - 스크립트 = 노드 테이블. 노드 하나가 대화 한 장면.
 * - 선택지는 효과를 가지며 '다음 노드' 를 가리킨다. 없으면 대화가 끝난다.
 * - 모든 함수는 순수 함수. 스토어를 만지지 않는다. 적용은 main.ts 가 한다.
 */

/** 대화 선택지가 일으키는 변화.
 *  도시 수치(치안/상업)는 0~100 범위라 값을 크게 주지 않는다. */
export type DialogueEffect =
    | { kind: 'affinity'; amount: number }
    | { kind: 'stat'; stat: 'leadership' | 'might' | 'intelligence' | 'politics' | 'charisma'; amount: number }
    | { kind: 'city'; field: 'publicOrder' | 'commerce' | 'agriculture' | 'loyalty' | 'development'; amount: number }
    | { kind: 'gold'; amount: number }
    | { kind: 'danger'; amount: number }
    | { kind: 'log'; text: string };

/** 선택지 하나. */
export interface ScriptChoice {
    readonly id: string;
    readonly label: string;
    /** 오른쪽에 붙는 짧은 설명. '치안 +4' 같은 결과. */
    readonly desc?: string;
    readonly effects: readonly DialogueEffect[];
    /** 이 선택 뒤에 이어질 노드 id. 없으면 대화가 끝난다. */
    readonly next?: string;
    /** false 면 회색으로 잠긴다. */
    readonly enabled?: boolean;
    /** 잠겼을 때 보여줄 이유. */
    readonly lockedReason?: string;
}

/** 대화 한 장면. */
export interface ScriptNode {
    readonly id: string;
    readonly speaker: string;
    /** 화자 무장 id. 있으면 좌측에 초상이 그려진다. */
    readonly speakerId?: string;
    /** 사람이 아닌 화자(시장/교역소)의 표식. */
    readonly placeMark?: string;
    /** 화자의 말. 여러 줄이면 화자가 여러 마디를 한다. */
    readonly lines: readonly string[];
    /** 정보줄(우호도, 능력치 등). */
    readonly facts?: readonly string[];
    readonly choices: readonly ScriptChoice[];
    /** 계속 화살표로 넘어갈 다음 노드. 선택지가 없을 때 쓴다. */
    readonly next?: string;
}

export interface DialogueScript {
    readonly entry: string;
    readonly nodes: Readonly<Record<string, ScriptNode>>;
    /** 스크립트 마지막에 보여줄 한 줄. */
    readonly closing: string;
}

/** 결정론 시드용 해시 — FNV-1a. */
export function hashInt(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

export interface MarketScriptInput {
    cityName: string;
    commerce: number;
    publicOrder: number;
    danger: number;
    gold: number;
    population: number;
    isCapital: boolean;
    /** 결정론 시드. 월/도시 id 등을 넣는다. */
    seed: string;
}

/**
 * 불량배 사건의 심각도. 0=없음, 3=식량 위기.
 * 관리가 부실할수록 잘 일어난다 — 상업/치안을 보고 결정한다.
 */
export function grainScarcityLevel(
    input: Pick<MarketScriptInput, 'commerce' | 'publicOrder' | 'seed'>,
): 0 | 1 | 2 | 3 {
    const noise = hashInt(input.seed) % 100;
    const risk = (100 - input.publicOrder) * 0.6 + (100 - input.commerce) * 0.25 + noise * 0.15;
    if (risk < 42) return 0;
    if (risk < 60) return 1;
    if (risk < 76) return 2;
    return 3;
}

/** 규모가 크면 교역소가 있다. 인구가 많은 쪽일수록 확률이 오른다. */
export function hasTradePost(input: Pick<MarketScriptInput, 'population' | 'isCapital' | 'seed'>): boolean {
    if (input.isCapital) return true;
    if (input.population < 40000) return false;
    return hashInt(`trade|${input.seed}`) % 100 < 55;
}
/**
 * 시장 대화 스크립트 — 불량배 사건.
 * 요구한 흐름 그대로: 시장 클릭 -> 불량배 사실 -> [선택지] -> 처리 장면 -> [다시 선택] -> 끝
 */
export function buildMarketScript(input: MarketScriptInput): DialogueScript {
    const level = grainScarcityLevel(input);
    const who = `${input.cityName} 상인`;

    // 사건이 없으면 요구/제안으로 넘어간다. 그래도 선택지는 있다.
    if (level === 0) {
        return {
            entry: 'calm',
            closing: `${input.cityName}의 시장은 크게 요동치지 않았다.`,
            nodes: {
                calm: {
                    id: 'calm', speaker: who, placeMark: '市',
                    lines: [
                        `“${input.cityName}의 쌀값은 지난달과 같습니다. 놀랄 일은 없사옵니다.”`,
                        '“다만 성하에 흰자만 돌아다닙니다. 눈에 보이는 사기꾼이옵니다.”',
                    ],
                    facts: [
                        `상업 ${input.commerce} · 치안 ${input.publicOrder}`,
                        `보유 ${input.gold.toLocaleString()}金`,
                    ],
                    choices: [
                        {
                            id: 'watch', label: '가짜를 찾아내라', desc: '치안 +3',
                            effects: [{ kind: 'city', field: 'publicOrder', amount: 3 }],
                        },
                        {
                            id: 'leave', label: '지금은 그대로 둔다', desc: '변화 없음',
                            effects: [{ kind: 'log', text: `${input.cityName} 시장을 지켜보기로 했다.` }],
                        },
                    ],
                },
            },
        };
    }

    const cost = level * 30;
    const canBuy = input.gold >= cost;
    const severeLine = level === 1
        ? `“${input.cityName}에 흰 쌀이 섞인 쌀이 굴러다닙니다.”`
        : level === 2
            ? `“많이 퍼졌습니다. 진짜 쌀이 아닌 것이옵니다.”`
            : `“밥솥을 비우지 않으면 사람이 죽습니다. 그것도 사람이옵니다.”`;

    return {
        entry: 'open',
        closing: level === 3
            ? '발을 크게 내질렀다. 먹고살 사람이 늘었다.'
            : '시장을 정리했다. 쌀값은 곧 오락가락했다.',
        nodes: {
            open: {
                id: 'open', speaker: who, placeMark: '市',
                lines: [
                    severeLine,
                    `“${cost}金을 드시면 좋은 쌀로 바꿔 드리겠사옵니다. 지금이 아니면 값을 못 받옵니다.”`,
                ],
                facts: [
                    `치안 ${input.publicOrder} · 상업 ${input.commerce}`,
                    `위험 ${input.danger} · 보유 ${input.gold.toLocaleString()}金`,
                ],
                choices: [
                    {
                        id: 'buy', label: `${cost}金 주고 좋은 쌀로 바꾼다`, desc: `금화 -${cost}`,
                        effects: [
                            { kind: 'gold', amount: -cost },
                            { kind: 'city', field: 'publicOrder', amount: level + 1 },
                            { kind: 'city', field: 'loyalty', amount: level },
                        ],
                        next: 'afterBuy', enabled: canBuy,
                        lockedReason: `금화가 부족합니다 (${cost}金 필요)`,
                    },
                    {
                        id: 'seize', label: '불량배를 몰아내라', desc: '치안 +2 · 위험 +1',
                        effects: [
                            { kind: 'city', field: 'publicOrder', amount: 2 },
                            { kind: 'danger', amount: 1 },
                            { kind: 'log', text: `${input.cityName}에서 불량배를 체포했다.` },
                        ],
                        next: 'afterSeize',
                    },
                    {
                        id: 'ignore', label: '모른 척한다', desc: '변화 없음',
                        effects: [{ kind: 'log', text: `${input.cityName}의 불량배를 모른 척했다.` }],
                    },
                ],
            },
            afterBuy: {
                id: 'afterBuy', speaker: who, placeMark: '市',
                lines: [
                    '“확인해 보시옵소서. 이번 쌀은 속이 없습니다.”',
                    '“다만 장사는 사람 목을 사지 못합니다. 돈보다 사람이 먼저옵니다.”',
                ],
                facts: [`금화 -${cost} · 치안 +${level + 1} · 충성 +${level}`],
                // 여기서 다시 한 번 고를 수 있다.
                choices: [
                    {
                        id: 'afterBuySeize', label: '그래도 불량배는 잡아라', desc: '치안 +2 · 위험 +1',
                        effects: [
                            { kind: 'city', field: 'publicOrder', amount: 2 },
                            { kind: 'danger', amount: 1 },
                        ],
                    },
                ],
            },
            afterSeize: {
                id: 'afterSeize', speaker: who, placeMark: '市',
                lines: [
                    '“쌀은 그만 둡니다. 사람만 둡니다. 북쪽 길목에 불량배가 숨었습니다.”',
                    '“치안은 오르겠지만, 그 길목은 밤에 고요하지 않사옵니다.”',
                ],
                facts: ['치안 +2 · 위험 +1'],
                choices: [
                    {
                        id: 'afterSeizeBuy', label: '그래도 좋은 쌀은 사야 한다', desc: `금화 -${cost}`,
                        effects: [
                            { kind: 'gold', amount: -cost },
                            { kind: 'city', field: 'loyalty', amount: level },
                        ],
                        enabled: input.gold >= cost,
                        lockedReason: `금화가 부족합니다 (${cost}金 필요)`,
                    },
                ],
            },
        },
    };
}
/* ============================================================
   교역 — 물자 사고팔기 [신규 기능]
   ============================================================ */

/** 교역 물품. 값은 기본가. 실제로는 계절/상업에 따라 흔들린다. */
export interface TradeGood {
    readonly id: string;
    readonly name: string;
    /** 도시가 우리에게 사는 값. */
    readonly baseBuy: number;
    /** 도시가 우리에게 파는 값. */
    readonly baseSell: number;
    /** 물자가 부족할수록 오른다. */
    readonly scarcity: number;
    readonly note: string;
}

export const TRADE_GOODS: readonly TradeGood[] = [
    { id: 'grain', name: '쌀', baseBuy: 8, baseSell: 12, scarcity: 12, note: '산다는 것. 값이 아니다' },
    { id: 'salt', name: '소금', baseBuy: 20, baseSell: 30, scarcity: 8, note: '돈이 된다' },
    { id: 'iron', name: '철', baseBuy: 35, baseSell: 52, scarcity: 6, note: '병기를 만든다' },
    { id: 'silk', name: '비단', baseBuy: 70, baseSell: 100, scarcity: 4, note: '도시가 크면 오르내린다' },
    { id: 'horse', name: '마', baseBuy: 90, baseSell: 130, scarcity: 3, note: '군대가 원한다' },
];

export interface TradeOfferInput {
    cityName: string;
    commerce: number;
    publicOrder: number;
    month: number;
    gold: number;
    isTradePost: boolean;
    seed: string;
}

export interface TradeOfferRow {
    readonly good: TradeGood;
    readonly buy: number;
    readonly sell: number;
    /** 교역소가 아니면 1보다 크다 — 도매값을 모른다. */
    readonly markup: number;
}

/** 계절에 따른 가격 변동. 겨울이 가장 비싸다. */
export function seasonMultiplier(month: number): number {
    if (month <= 2 || month === 12) return 1.25;   // 겨울
    if (month <= 5) return 1.0;                     // 봄
    if (month <= 8) return 0.9;                     // 여름 (풍년)
    return 1.1;                                     // 가을 (수확 전 고름)
}

/**
 * 실제 매입/매도가.
 * 도시가 바쁠수록(상업/치안) 비싸게 사고 싸게 팔아야 한다 — 중개 수수료.
 * 화물이 끊긴 곳(치안 낮음)에는 물자가 널브러워 싼 물자가 돌아온다.
 */
export function quoteTrade(
    good: TradeGood,
    input: { commerce: number; publicOrder: number; month: number },
): { buy: number; sell: number } {
    const busy = (input.commerce + input.publicOrder) / 200; // 0~1
    const margin = 1 + (0.5 - busy) * 0.24;                  // 중개 수수료
    const season = seasonMultiplier(input.month);
    const scarcity = 1 + good.scarcity / 100;
    return {
        buy: Math.max(1, Math.round(good.baseBuy * margin * season * scarcity)),
        sell: Math.max(1, Math.round(good.baseSell * margin)),
    };
}

/** 이 값으로 몇 자 살 수 있는지. 가진 만큼만. */
export function maxAffordable(unitPrice: number, gold: number, unitSize = 10): number {
    if (unitPrice <= 0) return 0;
    return Math.max(0, Math.floor(gold / unitPrice) * unitSize);
}

/** 교역소 여부에 따라 물자표를 만든다. */
export function buildTradeOffer(input: TradeOfferInput): TradeOfferRow[] {
    return TRADE_GOODS.map(good => {
        const q = quoteTrade(good, input);
        const markup = input.isTradePost ? 1 : 1.25;
        return { good, buy: q.buy, sell: Math.round(q.sell * markup), markup };
    });
}
/**
 * 교역소 대화 스크립트.
 * 대화가 이어지는 동안 아래 교역 패널에서 사고팔 수 있다.
 * '더 고른다' 를 고르면 같은 자리에서 다시 조율할 수 있다.
 */
export function buildTradeScript(input: TradeOfferInput): DialogueScript {
    const offer = buildTradeOffer(input);
    const where = input.isTradePost ? '교역소' : '시장 행상';
    // 실제 차이( sell - buy )가 가장 큰 물자를 '유리한 물자' 로 고른다.
    const best = [...offer].sort((a, b) => (b.sell - b.buy) - (a.sell - a.buy))[0];
    const speaker = `${input.cityName} ${where} 상인`;

    return {
        entry: 'open',
        closing: `${input.cityName} ${where}에서 물자를 옮겼다.`,
        nodes: {
            open: {
                id: 'open', speaker, placeMark: '貿',
                lines: [
                    input.isTradePost
                        ? `“어서 오시옵소서. ${input.cityName} 교역소입니다. 값이 쌉니다.”`
                        : `“시장에 오신 것을 환영하옵니다. 값이 조금 있습니다.”`,
                    `“지금은 ${best.good.name}가 제일 유리하옵니다.”`,
                ],
                facts: [
                    `상업 ${input.commerce} · 치안 ${input.publicOrder}`,
                    `보유 ${input.gold.toLocaleString()}金`,
                ],
                choices: [
                    { id: 'deal', label: '물건을 고른다', desc: '아래에서 사고판다', effects: [], next: 'dealing' },
                    {
                        id: 'listen', label: '시장을 듣는다', desc: '상업 +1',
                        effects: [{ kind: 'city', field: 'commerce', amount: 1 }], next: 'news',
                    },
                    { id: 'bye', label: '오늘은 여기까지', desc: '대화 종료', effects: [] },
                ],
            },
            dealing: {
                id: 'dealing', speaker, placeMark: '貿',
                lines: [
                    '“마음에 드는 것을 담으옵소서. 값은 두고 볼 수 없사옵니다.”',
                    '“더 담고 싶으면 또 고르시옵소서.”',
                ],
                choices: [
                    { id: 'more', label: '더 고른다', desc: '계속 거래', effects: [], next: 'open' },
                    { id: 'done', label: '거래를 마친다', desc: '대화 종료', effects: [] },
                ],
            },
            news: {
                id: 'news', speaker, placeMark: '貿',
                lines: [
                    '“북쪽 길이 막혔다더군요. 값을 아는 분이 먼저 하옵니다.”',
                    '“물자를 미리 놓는 눈이 있는 기벌이옵니다. 아직 늦지 않았사옵니다.”',
                ],
                choices: [
                    {
                        id: 'thenTrade', label: '그래도 물건을 본다', desc: '상업 +1',
                        effects: [{ kind: 'city', field: 'commerce', amount: 1 }], next: 'open',
                    },
                    { id: 'end', label: '듣기만 한다', desc: '대화 종료', effects: [] },
                ],
            },
        },
    };
}

/* ============================================================
   실행기
   ============================================================ */

/**
 * 스크립트 실행기.
 *
 * 상태는 '지금 어느 노드에 있는가' 뿐이다. 되돌아가기(◀)는 방문 이력으로 한다.
 * 데미지 없이 되돌아갈 수 있어야 "다시 선택" 이 성립한다.
 */
export class ScriptRunner {
    private history: string[] = [];
    /** 다음 장면 없는 선택지를 고르면 대화가 끝난다. 되돌아가면 다시 false. */
    private ended = false;

    constructor(private readonly script: DialogueScript) {
        this.history = [script.entry];
    }

    /** 현재 노드. 정의가 깨져 있으면 undefined. */
    get current(): ScriptNode | undefined {
        return this.script.nodes[this.history[this.history.length - 1]];
    }

    get canGoBack(): boolean {
        return this.history.length > 1;
    }

    get visitedCount(): number {
        return this.history.length;
    }

    /** 대화가 끝났으면 true. 끝 장면에 닿았거나, 마지막 선택지를 고른 경우. */
    get finished(): boolean {
        if (this.ended) return true;
        const node = this.current;
        return !node || (node.choices.length === 0 && !node.next);
    }

    /** 선택지를 고른다. 다음 노드가 있으면 이동, 없으면 대화가 끝난다. */
    choose(choiceId: string): { next: ScriptNode | undefined; ended: boolean } {
        const node = this.current;
        const choice = node?.choices.find(c => c.id === choiceId);
        if (!node || !choice || choice.enabled === false) return { next: node, ended: true };
        // 다음 장면이 없는 선택지 = 대화를 마무리하는 선택지.
        // 이대로 두면 같은 선택지에 갇힌다. 반드시 종료시켜야 한다.
        if (!choice.next || !this.script.nodes[choice.next]) {
            this.ended = true;
            return { next: node, ended: true };
        }
        this.ended = false;
        this.history.push(choice.next);
        return { next: this.current, ended: this.finished };
    }

    /** 계속 화살표로 다음 장면으로 넘어간다. */
    advance(): { next: ScriptNode | undefined; ended: boolean } {
        const node = this.current;
        if (!node) return { next: undefined, ended: true };
        if (node.next && this.script.nodes[node.next]) {
            this.ended = false;
            this.history.push(node.next);
            return { next: this.current, ended: this.finished };
        }
        this.ended = true;
        return { next: node, ended: true };
    }

    back(): void {
        if (this.canGoBack) {
            this.history.pop();
            this.ended = false;
        }
    }

    /** 특정 장면으로 되돌아간다. */
    jumpTo(nodeId: string): boolean {
        if (!this.script.nodes[nodeId]) return false;
        while (this.history[this.history.length - 1] !== nodeId) {
            if (!this.canGoBack) return false;
            this.history.pop();
        }
        this.ended = false;
        return true;
    }
}

const CITY_LABEL: Record<string, string> = {
    publicOrder: '치안', commerce: '상업', agriculture: '농업',
    loyalty: '충성', development: '개발',
};
const STAT_LABEL: Record<string, string> = {
    leadership: '통솔', might: '무력', intelligence: '지력',
    politics: '정치', charisma: '매력',
};

function sign(n: number): string {
    return `${n >= 0 ? '+' : ''}${n}`;
}

/** 효과를 사람이 읽을 한 줄로. '금화 -90 · 치안 +3' */
export function describeEffects(effects: readonly DialogueEffect[]): string {
    const parts: string[] = [];
    for (const e of effects) {
        if (e.kind === 'log') continue;
        if (e.kind === 'city') parts.push(`${CITY_LABEL[e.field]} ${sign(e.amount)}`);
        else if (e.kind === 'stat') parts.push(`${STAT_LABEL[e.stat]} ${sign(e.amount)}`);
        else if (e.kind === 'affinity') parts.push(`우호도 ${sign(e.amount)}`);
        else if (e.kind === 'gold') parts.push(`금화 ${sign(e.amount)}`);
        else if (e.kind === 'danger') parts.push(`위험 ${sign(e.amount)}`);
    }
    return parts.join(' · ');
}
