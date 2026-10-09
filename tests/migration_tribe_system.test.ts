/**
 * 이민족 교섭 시스템 — 교환 곡선·지원·철회 검증.
 *
 * [왜 순수 로직을 브라우저 없이 검증하는가]
 * 이 모듈은 스토어/DOM 에 의존하지 않는다. 그래서 "우호도가 오르면 가격이 내려간다" 같은
 * 사양을 결정적으로 검증할 수 있다. 확률 판정은 roll 을 주입해 0/1 경계를 고정한다.
 */
import { describe, it, expect } from 'vitest';
import {
    AFFINITY_MIN, AFFINITY_MAX, AFFINITY_GAIN_PER_NEGOTIATION,
    MAX_AFFINITY_DISCOUNT, BASE_GRAIN_PRICE_PER_GRAIN,
    normalizeAffinity, affinityDiscount, grainPricePerUnit, isPriceMonotonic,
    quoteGrainForGold, quoteGoldForGrain, quantizeTrade,
    aidSuccessChance, retractSuccessChance, demandWeight,
    isTribeAtCity, isTribeNearCity, tribesNearCity, shouldDepart,
    tradeGrainForGold, tradeGoldForGrain, requestGrainAid, requestTroopAid, demandRetraction,
    buildTribeRoster, DEFAULT_TRIBE_PLACEMENTS,
    planMonthlyTribeAffairs, demandsAbandonedBy, DEPART_AFFINITY_PENALTY, FRONTIER_REGION,
    troopAidPayout,
    type TribeState, type InvasionDemand, type NegotiationContext,
} from '../src/core/migration_tribe_system.js';
import { GameStore } from '../src/core/game_store.js';

function tribe(over: Partial<TribeState> = {}): TribeState {
    return {
        id: 't1', name: '오랑', settlement: { kind: 'CITY', cityId: 'city_辽东' },
        strength: 1000, affinity: 0, grainStock: 500, troopStock: 600,
        backingDemandIds: ['d1'], negotiatedThisMonth: false, ...over,
    };
}

/** 확률 판정을 항상 성공/실패로 고정한다. */
const always = () => 0;
const never = () => 1;

describe('우호도 정규화', () => {
    it('양 끝값이 0/1 로 눌린다', () => {
        expect(normalizeAffinity(AFFINITY_MIN)).toBe(0);
        expect(normalizeAffinity(AFFINITY_MAX)).toBe(1);
    });

    it('범위를 벗어나도 잘리지 않는다', () => {
        expect(normalizeAffinity(-9999)).toBe(0);
        expect(normalizeAffinity(9999)).toBe(1);
    });

    it('0 이면 중간값이다', () => {
        expect(normalizeAffinity(0)).toBeCloseTo(0.5, 5);
    });
});

describe('우호도 할인과 호가', () => {
    it('할인율은 상한을 넘지 않는다', () => {
        for (const a of [-100, -50, 0, 50, 100]) {
            expect(affinityDiscount(a)).toBeLessThanOrEqual(MAX_AFFINITY_DISCOUNT + 1e-9);
            expect(affinityDiscount(a)).toBeGreaterThanOrEqual(0);
        }
    });

    it('우호도가 오르면 단가가 내려간다 (전 구간 단조)', () => {
        for (let a = AFFINITY_MIN; a < AFFINITY_MAX; a += 5) {
            expect(isPriceMonotonic(a), `우호도 ${a} 부근이 역전`).toBe(true);
        }
    });

    it('최저 우호도에서는 정찰', () => {
        expect(grainPricePerUnit(AFFINITY_MIN)).toBeCloseTo(BASE_GRAIN_PRICE_PER_GRAIN, 6);
    });

    it('최고 우호도에서 정확히 상한만큼 깎인다', () => {
        const expected = BASE_GRAIN_PRICE_PER_GRAIN * (1 - MAX_AFFINITY_DISCOUNT);
        expect(grainPricePerUnit(AFFINITY_MAX)).toBeCloseTo(expected, 6);
    });

    it('가격은 항상 양수다 (무료가 되지 않는다)', () => {
        for (let a = AFFINITY_MIN; a <= AFFINITY_MAX; a += 10) {
            expect(grainPricePerUnit(a)).toBeGreaterThan(0);
        }
    });
});

describe('거래 호가', () => {
    it('금→糧 은 우호도가 오르면 싸진다', () => {
        expect(quoteGrainForGold(100, 0)).toBeGreaterThan(quoteGrainForGold(100, 100));
        expect(quoteGrainForGold(100, 80)).toBeLessThan(quoteGrainForGold(100, 20));
    });

    it('糧→금 도 우호도가 오르면 불리해진다 (가는 쪽 환율)', () => {
        // reverse 방향: 糧을 주고 金을 산다. 친밀할수록 "파는 쪽"이 유리하므로
        // 플레이어가 받는 金 이 줄어든다.
        expect(quoteGoldForGrain(100, 100)).toBeLessThan(quoteGoldForGrain(100, 0));
    });

    it('거래량은 배수로 올라간다', () => {
        expect(quoteGrainForGold(200, 0)).toBe(quoteGrainForGold(100, 0) * 2);
    });

    it('정수化 — 소수 金 을 내지 않는다', () => {
        for (const a of [-100, -33, 0, 17, 100]) {
            for (const q of [1, 7, 33, 100]) {
                const r = quoteGrainForGold(q, a);
                expect(Number.isInteger(r), `우호도 ${a} 수량 ${q}`).toBe(true);
                expect(r).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('quantizeTrade 은 음수를 0 으로 깬다', () => {
        expect(quantizeTrade(-50)).toBe(0);
        expect(quantizeTrade(12.9)).toBe(12);
    });
});

describe('지원 성공 확률', () => {
    it('우호도가 오르면 확률이 오른다', () => {
        for (let a = AFFINITY_MIN; a < AFFINITY_MAX; a += 10) {
            expect(aidSuccessChance(a + 10)).toBeGreaterThan(aidSuccessChance(a));
        }
    });

    it('바닥/천장을 넘지 않는다', () => {
        for (let a = -500; a <= 500; a += 7) {
            const p = aidSuccessChance(a);
            expect(p).toBeGreaterThan(0);
            expect(p).toBeLessThan(1);
        }
    });
});

describe('침략 요구 철회', () => {
    const wholeFaction: InvasionDemand = {
        id: 'd1', issuerFactionId: 'fac_0', targetCityId: null,
        targetsWholeFaction: true, monthsRemaining: 3, withdrawn: false,
    };
    const singleCity: InvasionDemand = {
        id: 'd2', issuerFactionId: 'fac_0', targetCityId: 'city_幽州',
        targetsWholeFaction: false, monthsRemaining: 2, withdrawn: false,
    };

    it('세력 전체 요구가 도시 1곳 요구보다 무겁다', () => {
        expect(demandWeight(wholeFaction)).toBeGreaterThan(demandWeight(singleCity));
    });

    it('무거운 요구일수록 확률이 낮다', () => {
        expect(retractSuccessChance(100, demandWeight(wholeFaction)))
            .toBeLessThan(retractSuccessChance(100, demandWeight(singleCity)));
    });

    it('성공하면 요구 id 를 돌려준다', () => {
        const r = demandRetraction(tribe({ affinity: 100 }), wholeFaction, always);
        expect(r.success).toBe(true);
        expect(r.withdrawnDemandId).toBe('d1');
    });

    it('실패하면 요구 id 를 돌려주지 않는다', () => {
        const r = demandRetraction(tribe({ affinity: 0 }), wholeFaction, never);
        expect(r.success).toBe(false);
        expect(r.withdrawnDemandId).toBeNull();
    });

    it('교섭 대상이 아닌 요구는 우호도 변화 없이 거절된다', () => {
        const t = tribe({ backingDemandIds: ['other'] });
        const r = demandRetraction(t, wholeFaction, always);
        expect(r.success).toBe(false);
        expect(r.newAffinity).toBe(t.affinity);
    });

    it('이미 철회된 요구는 거절된다', () => {
        const done = { ...wholeFaction, withdrawn: true };
        const r = demandRetraction(tribe(), done, always);
        expect(r.success).toBe(false);
        expect(r.message).toContain('이미');
    });

    it('기한이 지난 요구도 철회된 것으로 본다', () => {
        const expired = { ...wholeFaction, monthsRemaining: 0 };
        expect(demandRetraction(tribe(), expired, always).success).toBe(false);
    });

    it('실패하면 우호도가 내려간다', () => {
        const t = tribe({ affinity: 50 });
        const r = demandRetraction(t, wholeFaction, never);
        expect(r.newAffinity).toBeLessThan(50);
    });
});

describe('도시 근처 판정', () => {
    it('같은 도시에 있으면 참', () => {
        expect(isTribeAtCity(tribe(), 'city_辽东')).toBe(true);
        expect(isTribeAtCity(tribe(), 'city_幽州')).toBe(false);
    });

    it('이웃 도시에도 nearby 로 잡힌다', () => {
        expect(isTribeNearCity(tribe(), 'city_幽州', ['city_辽东'])).toBe(true);
    });

    it('이웃이 아니면 false', () => {
        expect(isTribeNearCity(tribe(), 'city_成都', ['city_南阳'])).toBe(false);
    });

    it('REGION 이주는 도시 판정에서 제외된다', () => {
        const t = tribe({ settlement: { kind: 'REGION', region: '두만강' } });
        expect(isTribeAtCity(t, 'city_辽东')).toBe(false);
        expect(tribesNearCity([t], 'city_辽东', ['city_辽东'])).toHaveLength(0);
    });

    it('도시 주변 부족만 골라낸다', () => {
        const list = [
            tribe({ id: 'a', settlement: { kind: 'CITY', cityId: 'city_辽东' } }),
            tribe({ id: 'b', settlement: { kind: 'CITY', cityId: 'city_成都' } }),
        ];
        expect(tribesNearCity(list, 'city_幽州', ['city_辽东']).map(t => t.id)).toEqual(['a']);
    });
});

describe('거래 실행', () => {
    const ctx = (t: TribeState, gold = 100000, food = 100000): NegotiationContext =>
        ({ playerGold: gold, playerFood: food, tribe: t });

    it('금으로 糧 을 사면 돈을 쓰고 우호도가 오른다', () => {
        const r = tradeGrainForGold(ctx(tribe({ affinity: 0 })), 50);
        expect(r.success).toBe(true);
        expect(r.goldSpent).toBeGreaterThan(0);
        expect(r.grainMoved).toBe(50);
        expect(r.newAffinity).toBe(AFFINITY_GAIN_PER_NEGOTIATION);
    });

    it('금이 모자라면 거래가 막힌다', () => {
        const r = tradeGrainForGold(ctx(tribe(), 0), 10);
        expect(r.success).toBe(false);
        expect(r.goldSpent).toBe(0);
        expect(r.message).toContain('부족');
    });

    it('부족의 糧이 모자라면 막힌다', () => {
        const r = tradeGrainForGold(ctx(tribe({ grainStock: 5 })), 100);
        expect(r.success).toBe(false);
        expect(r.grainMoved).toBe(0);
    });

    it('0 이하 수량은 거절된다', () => {
        expect(tradeGrainForGold(ctx(tribe()), 0).success).toBe(false);
        expect(tradeGrainForGold(ctx(tribe()), -5).success).toBe(false);
    });

    it('糧으로 금을 사면 糧 이 줄어든다', () => {
        const r = tradeGoldForGrain(ctx(tribe()), 40);
        expect(r.success).toBe(true);
        expect(r.goldSpent).toBe(40);
        expect(r.grainMoved).toBeGreaterThan(0);
    });

    it('우호도가 이미 꽉 찼으면 더 오르지 않는다', () => {
        const r = tradeGrainForGold(ctx(tribe({ affinity: AFFINITY_MAX })), 10);
        expect(r.newAffinity).toBe(AFFINITY_MAX);
    });
});

describe('지원 요청', () => {
    it('군량미 지원은 재고를 넘지 않는다', () => {
        const r = requestGrainAid(tribe({ grainStock: 50, affinity: 100 }), always);
        expect(r.success).toBe(true);
        expect(r.grain).toBe(50);
    });

    it('병력 지원은 재고를 넘지 않는다', () => {
        const r = requestTroopAid(tribe({ troopStock: 30, affinity: 100 }), always);
        expect(r.success).toBe(true);
        expect(r.soldiers).toBe(30);
    });

    it('거절해도 0 을 준다 (음수 없음)', () => {
        const g = requestGrainAid(tribe(), never);
        const s = requestTroopAid(tribe(), never);
        expect(g.success).toBe(false);
        expect(g.grain).toBe(0);
        expect(s.soldiers).toBe(0);
    });

    it('지원 요청은 항상 상한을 넘지 않는다', () => {
        const r = requestTroopAid(tribe({ troopStock: 999999, affinity: 100 }), always);
        expect(r.soldiers).toBeLessThanOrEqual(500);
    });
});

describe('이주 판정', () => {
    it('우호도가 높을수록 잘 떠나지 않는다', () => {
        let stayCount = 0;
        for (let i = 0; i < 200; i++) {
            if (!shouldDepart(tribe({ affinity: 100 }), () => 0.3)) stayCount++;
        }
        expect(stayCount).toBeGreaterThan(150);
    });

    it('우호도가 낮으면 떠나기 쉽다', () => {
        expect(shouldDepart(tribe({ affinity: AFFINITY_MIN }), () => 0.1)).toBe(true);
    });

    it('결정론적 — 같은 roll 은 같은 결과', () => {
        const t = tribe();
        expect(shouldDepart(t, () => 0.9)).toBe(shouldDepart(t, () => 0.9));
    });
});

describe('초기 배치 roster', () => {
    const names: Record<string, string> = { 상용: 'city_상용', 진양: 'city_진양', 무창: 'city_무창' };

    it('실제 존재하는 도시에만 배치한다', () => {
        const roster = buildTribeRoster(names);
        // 교지 는 맵에 없으므로 배치에서 빠진다.
        expect(roster.map(t => t.id)).toEqual(['tribe_xiongnu', 'tribe_wuhuan', 'tribe_xianbei']);
    });

    it('부족마다 고유 id 가 있다', () => {
        const roster = buildTribeRoster(names);
        expect(new Set(roster.map(t => t.id)).size).toBe(roster.length);
    });

    it('초기 우호도가 범위를 벗어나지 않는다', () => {
        for (const t of buildTribeRoster(names)) {
            expect(t.affinity).toBeGreaterThanOrEqual(AFFINITY_MIN);
            expect(t.affinity).toBeLessThanOrEqual(AFFINITY_MAX);
        }
    });

    it('빈 맵이면 아무것도 배치하지 않는다', () => {
        expect(buildTribeRoster({})).toHaveLength(0);
    });
});

describe('스토어 접근자', () => {
    it('set/get/byCity 가 서로 일치한다', () => {
        const store = new GameStore();
        store.setMigrationTribes([tribe({ id: 'a', settlement: { kind: 'CITY', cityId: 'c1' } })]);
        expect(store.getMigrationTribe('a')?.id).toBe('a');
        expect(store.getAllMigrationTribes()).toHaveLength(1);
        expect(store.getTribesByCity('c1').map(t => t.id)).toEqual(['a']);
        expect(store.getTribesByCity('other')).toHaveLength(0);
    });

    it('이주하면 도시 인덱스를 함께 옮긴다 — 남은 고아를 막는다', () => {
        const store = new GameStore();
        store.setMigrationTribes([tribe({ id: 'a', settlement: { kind: 'CITY', cityId: 'c1' } })]);
        store.updateMigrationTribe('a', { settlement: { kind: 'CITY', cityId: 'c2' } });
        expect(store.getTribesByCity('c1'), '떠난 도시에 남아 있다').toHaveLength(0);
        expect(store.getTribesByCity('c2').map(t => t.id)).toEqual(['a']);
    });

    it('REGION 이주가 되면 도시 인덱스에서 빠진다', () => {
        const store = new GameStore();
        store.setMigrationTribes([tribe({ id: 'a', settlement: { kind: 'CITY', cityId: 'c1' } })]);
        store.updateMigrationTribe('a', { settlement: { kind: 'REGION', region: '두만강' } });
        expect(store.getTribesByCity('c1')).toHaveLength(0);
    });

    it('없는 부족 갱신은 무시된다', () => {
        const store = new GameStore();
        store.updateMigrationTribe('ghost', { affinity: 99 });
        expect(store.getMigrationTribe('ghost')).toBeNull();
    });

    it('세이브 왕복에서 부족과 요구가 살아남는다', () => {
        const store = new GameStore();
        store.setMigrationTribes([tribe({ id: 'a', affinity: 42 })]);
        const snap = JSON.parse(JSON.stringify(store.createSnapshot()));
        expect(snap.migrationTribes.a.affinity).toBe(42);
        const restored = new GameStore();
        restored.restoreSnapshot(snap);
        expect(restored.getMigrationTribe('a')?.affinity).toBe(42);
    });
});

describe('침략 요구 스토어', () => {
    it('갱신이 되돌아오지 않는다', () => {
        const store = new GameStore();
        store.restoreSnapshot({ ...store.createSnapshot() });
        // 요구는 개입적으로 추가되므로 update 는 존재하는 것만 건드린다.
        store.updateInvasionDemand('missing', { withdrawn: true });
        expect(store.getAllInvasionDemands()).toHaveLength(0);
    });
});

describe('월간 부족 affairs', () => {
    function demand(over: Partial<InvasionDemand> = {}): InvasionDemand {
        return {
            id: 'd1', issuerFactionId: 'f1', targetCityId: 'c1',
            targetsWholeFaction: false, monthsRemaining: 3, withdrawn: false, ...over,
        };
    }

    it('이번 달 교섭했어도 잠금이 풀린다', () => {
        const t = tribe({ negotiatedThisMonth: true, affinity: 100 });
        const [u] = planMonthlyTribeAffairs([t], [], () => 0.999);
        expect(u.negotiatedThisMonth).toBe(false);
    });

    it('남아 있으면 도시를 그대로 유지한다', () => {
        const t = tribe({ affinity: 100 });
        const [u] = planMonthlyTribeAffairs([t], [], () => 0.999);
        expect(u.departed).toBe(false);
        expect(u.settlement).toEqual(t.settlement);
        expect(u.affinity).toBe(100);
        expect(u.message).toBeNull();
    });

    it('떠나면 변방 지역으로 이주하고 우호도가 떨어진다', () => {
        const t = tribe({ affinity: -100 });
        const [u] = planMonthlyTribeAffairs([t], [], () => 0);
        expect(u.departed).toBe(true);
        expect(u.settlement).toEqual({ kind: 'REGION', region: FRONTIER_REGION });
        expect(u.affinity).toBe(AFFINITY_MIN);
        expect(u.message).toContain('떠났다');
    });

    it('떠나도 우호도 하한을 넘지 않는다', () => {
        const [u] = planMonthlyTribeAffairs([tribe({ affinity: AFFINITY_MIN })], [], () => 0);
        expect(u.affinity).toBeGreaterThanOrEqual(AFFINITY_MIN);
    });

    it('우호도가 높을수록 덜 떠나간다 — 같은 roll 이면 우호도 낮은 쪽만 떠난다', () => {
        const friendly = planMonthlyTribeAffairs([tribe({ affinity: AFFINITY_MAX })], [], () => 0.2);
        const hostile = planMonthlyTribeAffairs([tribe({ affinity: AFFINITY_MIN })], [], () => 0.2);
        expect(friendly[0].departed).toBe(false);
        expect(hostile[0].departed).toBe(true);
    });

    it('떠난 부족은 미철회 요구를 버리고 간다', () => {
        const t = tribe({ affinity: -100, backingDemandIds: ['d1', 'd2'] });
        const demands = [demand({ id: 'd1' }), demand({ id: 'd2' }), demand({ id: 'other' })];
        const [u] = planMonthlyTribeAffairs([t], demands, () => 0);
        expect(demandsAbandonedBy(u, t, demands).sort()).toEqual(['d1', 'd2']);
    });

    it('이미 철회된 요구는 버리고 간 목록에 없다', () => {
        const t = tribe({ affinity: -100, backingDemandIds: ['d1'] });
        const demands = [demand({ id: 'd1', withdrawn: true })];
        const [u] = planMonthlyTribeAffairs([t], demands, () => 0);
        expect(demandsAbandonedBy(u, t, demands)).toEqual([]);
    });

    it('남아 있으면 요구는 그대로 둔다', () => {
        const t = tribe({ affinity: 100, backingDemandIds: ['d1'] });
        const demands = [demand({ id: 'd1' })];
        const [u] = planMonthlyTribeAffairs([t], demands, () => 0.999);
        expect(demandsAbandonedBy(u, t, demands)).toEqual([]);
    });

    it('부족이 없으면 갱신도 없다', () => {
        expect(planMonthlyTribeAffairs([], [], () => 0)).toEqual([]);
    });
});

describe('구 세이브 마이그레이션', () => {
    it('이민족 필드가 없는 구 스냅샷도 복원된다', () => {
        const store = new GameStore();
        const legacy = store.createSnapshot() as Record<string, unknown>;
        delete legacy.migrationTribes;
        delete legacy.invasionDemands;
        (legacy.byCity as Record<string, unknown>).tribes = undefined;

        const restored = new GameStore();
        restored.restoreSnapshot(legacy as never);
        expect(restored.getAllMigrationTribes()).toEqual([]);
        expect(restored.getTribesByCity('c1')).toEqual([]);
        expect(restored.getAllInvasionDemands()).toEqual([]);
    });

    it('도시 인덱스가 비어도 setter 로 되살아난다', () => {
        const store = new GameStore();
        const legacy = store.createSnapshot() as Record<string, unknown>;
        (legacy.byCity as Record<string, unknown>).tribes = undefined;
        const restored = new GameStore();
        restored.restoreSnapshot(legacy as never);
        restored.setMigrationTribes([tribe({ id: 'a', settlement: { kind: 'CITY', cityId: 'c1' } })]);
        expect(restored.getTribesByCity('c1').map(t => t.id)).toEqual(['a']);
    });
});

describe('병력 지원 지급', () => {
    it('한도 안이면 전액 지급한다', () => {
        expect(troopAidPayout(300, 1000, 5000)).toEqual({ granted: 300, capped: false });
    });

    it('한도를 넘으면 나머지를 잘라내고 capped 를 알린다', () => {
        expect(troopAidPayout(500, 9800, 10000)).toEqual({ granted: 200, capped: true });
    });

    it('이미 한도면 아무것도 지급하지 않는다', () => {
        expect(troopAidPayout(500, 10000, 10000)).toEqual({ granted: 0, capped: true });
    });

    it('한도가 병력보다 낮아도 음수가 되지 않는다', () => {
        expect(troopAidPayout(500, 10000, 100).granted).toBe(0);
    });

    it('지원 수가 0 이하면 지급하지 않는다', () => {
        expect(troopAidPayout(0, 100, 5000)).toEqual({ granted: 0, capped: false });
        expect(troopAidPayout(-5, 100, 5000).granted).toBe(0);
    });

    it('부족이 줄이는 병력은 지급된 만큼이다', () => {
        const { granted } = troopAidPayout(500, 9800, 10000);
        expect(900 - granted).toBe(700);
    });
});
