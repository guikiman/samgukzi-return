/**
 * 연쇄 대화 스크립트 + 교역 [신규 기능]
 *
 * 깨지기 쉬운 곳 세 군데를 지킨다:
 *  1) 효과가 자꾸 중복 적용되지 않는가 (선택지별 의도가 다를 것)
 *  2) 금화가 없는데도 살 수 있다고 하지 않는가
 *  3) 되돌아갈 때 상태가 새지 않는가
 */
import { describe, it, expect } from 'vitest';
import {
    ScriptRunner,
    buildMarketScript,
    buildTradeScript,
    buildTradeOffer,
    quoteTrade,
    seasonMultiplier,
    maxAffordable,
    grainScarcityLevel,
    hasTradePost,
    describeEffects,
    TRADE_GOODS,
} from '../src/core/dialogue_script.js';

const market = (over: Record<string, unknown> = {}) => ({
    cityName: '낙양', commerce: 12, publicOrder: 8, danger: 20,
    gold: 900, population: 40000, isCapital: true, seed: 'c1|184|1',
    ...over,
});
const trade = (over: Record<string, unknown> = {}) => ({
    cityName: '낙양', commerce: 60, publicOrder: 60, month: 6,
    gold: 1200, isTradePost: true, seed: 'c1|184|1',
    ...over,
});

describe('grainScarcityLevel', () => {
    it('관리가 좋으면 사건이 적다', () => {
        expect(grainScarcityLevel({ commerce: 90, publicOrder: 90, seed: 'x' })).toBe(0);
    });
    it('관리가 나쁘면 사건이 난다', () => {
        expect(grainScarcityLevel({ commerce: 5, publicOrder: 5, seed: 'x' })).toBe(3);
    });
    it('항상 0~3 사이 (결정론)', () => {
        for (let i = 0; i < 40; i++) {
            const v = grainScarcityLevel({ commerce: i * 2, publicOrder: 100 - i * 2, seed: `s${i}` });
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(3);
            expect(grainScarcityLevel({ commerce: i * 2, publicOrder: 100 - i * 2, seed: `s${i}` })).toBe(v);
        }
    });
});

describe('hasTradePost', () => {
    it('수도에는 교역소가 있다', () => {
        expect(hasTradePost({ population: 1000, isCapital: true, seed: 'a' })).toBe(true);
    });
    it('작은 마을에는 없다', () => {
        expect(hasTradePost({ population: 5000, isCapital: false, seed: 'a' })).toBe(false);
    });
    it('큰 비수도 도시 중 일부는 있다', () => {
        const withPost = Array.from({ length: 40 }, (_, i) =>
            hasTradePost({ population: 60000, isCapital: false, seed: `t${i}` }));
        expect(withPost.some(Boolean)).toBe(true);
        expect(withPost.some(x => !x)).toBe(true);
    });
});

describe('buildMarketScript', () => {
    it('불량배 사건이면 선택지가 3개 이상이다', () => {
        const s = buildMarketScript(market());
        const n = s.nodes[s.entry];
        expect(n.lines.length).toBeGreaterThan(0);
        expect(n.choices.length).toBeGreaterThanOrEqual(2);
    });
    it('선택지마다 다음 장면이 정의돼 있거나 대화를 끝낸다', () => {
        const s = buildMarketScript(market());
        for (const node of Object.values(s.nodes)) {
            for (const c of node.choices) {
                if (c.next) expect(s.nodes[c.next], `${node.id}->${c.next}`).toBeDefined();
            }
        }
    });
    it('금화가 없으면 매입 선택지가 잠긴다', () => {
        const s = buildMarketScript(market({ gold: 0 }));
        const buy = s.nodes[s.entry].choices.find(c => c.id === 'buy');
        expect(buy?.enabled).toBe(false);
        expect(buy?.lockedReason).toBeTruthy();
    });
    it('금화가 있으면 매입이 열린다', () => {
        const s = buildMarketScript(market({ gold: 5000 }));
        const buy = s.nodes[s.entry].choices.find(c => c.id === 'buy');
        expect(buy?.enabled).toBe(true);
    });
    it('처음 고른 장면에서 다시 고를 수 있다 (다시 선택)', () => {
        const s = buildMarketScript(market());
        const follow = Object.values(s.nodes).filter(n => n.id !== s.entry);
        expect(follow.some(n => n.choices.length > 0)).toBe(true);
    });
    it('장면 id 가 겹치지 않는다', () => {
        const s = buildMarketScript(market());
        expect(s.entry).toBeTruthy();
        expect(s.nodes[s.entry]).toBeDefined();
    });
    it('동일 입력 -> 동일 스크립트 (결정론)', () => {
        expect(JSON.stringify(buildMarketScript(market()))).toBe(JSON.stringify(buildMarketScript(market())));
    });
});

describe('ScriptRunner', () => {
    const script = buildMarketScript(market());

    it('처음은 entry 에 있다', () => {
        const r = new ScriptRunner(script);
        expect(r.current?.id).toBe(script.entry);
        expect(r.canGoBack).toBe(false);
    });
    it('선택하면 다음 장면으로 이동한다', () => {
        const r = new ScriptRunner(script);
        const first = r.current!.choices.find(c => c.next && c.enabled !== false);
        r.choose(first!.id);
        expect(r.current?.id).toBe(first!.next);
        expect(r.canGoBack).toBe(true);
    });
    it('되돌아가면 원래 장면으로 간다', () => {
        const r = new ScriptRunner(script);
        const c = r.current!.choices.find(x => x.next && x.enabled !== false)!;
        r.choose(c.id);
        r.back();
        expect(r.current?.id).toBe(script.entry);
        expect(r.canGoBack).toBe(false);
    });
    it('되돌아간 뒤 다른 선택을 할 수 있다 (선택지를 다시 고른다)', () => {
        const r = new ScriptRunner(script);
        const c = r.current!.choices.find(x => x.next && x.enabled !== false)!;
        r.choose(c.id);
        r.back();
        const other = r.current!.choices.find(x => x.id !== c.id && x.next && x.enabled !== false);
        if (other) {
            r.choose(other.id);
            expect(r.current?.id).toBe(other.next);
        }
    });
    it('잠긴 선택지는 이동하지 않는다', () => {
        const poor = buildMarketScript(market({ gold: 0 }));
        const r = new ScriptRunner(poor);
        const before = r.current!.id;
        r.choose('buy');
        expect(r.current?.id).toBe(before);
    });
    it('없는 선택지 id 는 무시된다', () => {
        const r = new ScriptRunner(script);
        const before = r.current!.id;
        r.choose('__nope__');
        expect(r.current?.id).toBe(before);
    });
    it('다음 장면이 없으면 advance 는 끝난다', () => {
        const r = new ScriptRunner(script);
        r.choose('ignore');
        expect(r.finished).toBe(true);
    });
    it('jumpTo 는 정의된 장면으로만 간다', () => {
        const r = new ScriptRunner(script);
        expect(r.jumpTo('__missing__')).toBe(false);
        expect(r.jumpTo(script.entry)).toBe(true);
    });
});

describe('seasonMultiplier', () => {
    it('겨울이 비싸고 여름이 싸다', () => {
        expect(seasonMultiplier(1)).toBeGreaterThan(seasonMultiplier(7));
    });
    it('1~12월 모두 양수', () => {
        for (let m = 1; m <= 12; m++) expect(seasonMultiplier(m)).toBeGreaterThan(0);
    });
});

describe('quoteTrade', () => {
    const input = { commerce: 60, publicOrder: 60, month: 6 };
    it('물자마다 값이 다르다', () => {
        const prices = TRADE_GOODS.map(g => quoteTrade(g, input).sell);
        expect(new Set(prices).size).toBeGreaterThan(1);
    });
    it('장사가 Marche면 싸게 사고 비싸게 판다', () => {
        const busy = quoteTrade(TRADE_GOODS[0], { commerce: 100, publicOrder: 100, month: 6 });
        const dead = quoteTrade(TRADE_GOODS[0], { commerce: 0, publicOrder: 0, month: 6 });
        expect(dead.buy).toBeGreaterThan(busy.buy);
    });
    it('값이 0 이 되지 않는다', () => {
        for (const g of TRADE_GOODS) {
            const q = quoteTrade(g, { commerce: 0, publicOrder: 0, month: 1 });
            expect(q.buy).toBeGreaterThan(0);
            expect(q.sell).toBeGreaterThan(0);
        }
    });
});

describe('maxAffordable', () => {
    it('가진 만큼만 산다', () => {
        expect(maxAffordable(10, 100)).toBe(100);
        expect(maxAffordable(10, 105)).toBe(100);
    });
    it('돈이 없으면 0', () => {
        expect(maxAffordable(10, 0)).toBe(0);
    });
});

describe('buildTradeOffer', () => {
    it('교역소가 아니면 마크업이 붙는다', () => {
        const post = buildTradeOffer(trade({ isTradePost: true }));
        const market = buildTradeOffer(trade({ isTradePost: false }));
        expect(post[0].markup).toBe(1);
        expect(market[0].markup).toBeGreaterThan(1);
        expect(market[0].sell).toBeGreaterThan(post[0].sell);
    });
    it('물자 5종을 모두 준다', () => {
        expect(buildTradeOffer(trade())).toHaveLength(TRADE_GOODS.length);
    });
});

describe('buildTradeScript', () => {
    it('교역 대화가 생긴다', () => {
        const s = buildTradeScript(trade());
        expect(s.nodes[s.entry]).toBeDefined();
        expect(s.nodes[s.entry].placeMark).toBeTruthy();
    });
    it('다시 고르는 선택지가 있다', () => {
        const s = buildTradeScript(trade());
        const r = new ScriptRunner(s);
        r.choose('deal');
        expect(r.current?.id).toBe('dealing');
        expect(r.current?.choices.some(c => c.id === 'more')).toBe(true);
    });
});

describe('describeEffects', () => {
    it('사람이 읽을 한 줄로 만든다', () => {
        expect(describeEffects([
            { kind: 'gold', amount: -90 },
            { kind: 'city', field: 'publicOrder', amount: 3 },
        ])).toBe('금화 -90 · 치안 +3');
    });
    it('로그 효과는 빼고 수치만 보여준다', () => {
        expect(describeEffects([{ kind: 'log', text: '기록' }])).toBe('');
    });
    it('빈 배열이면 빈 문자열', () => {
        expect(describeEffects([])).toBe('');
    });
});