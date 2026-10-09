/**
 * src/core/map_feature_siege_system.ts — 전략 요충지(관·요새) 점령 시스템 테스트
 * 파일: tests/map_feature_siege.test.ts
 *
 * [무엇을 검증하는가]
 * 개시 판정 → 포위 개월 산정 → 출진 개시 → 월간 진행(파산/함락/기한 만료)까지
 * "포위 개월 1 줄고 수비군 50% 깎인다" 같은 경계 규칙을 roll 없이 결정론적으로 검증한다.
 *
 * [왜 숫자를 하드코딩하는가]
 * 소스의 상수(0.5 / 0.15 / 200 / 1000)를 그대로 다시 쓰면 상수를 바꿨을 때
 * 테스트도 같이 바뀌어 회귀를 못 잡는다. 그래서 핵심 감소율은 리터럴로 적고
 * "상수는 그 값과 같다" 는 계약을 별도 테스트로 고정한다.
 *
 * [결함 기록]
 * 이 파일에는 구현의 방어 공백을 "현재 동작" 으로 고정한 테스트가 몇 개 있다.
 * (미사용 파라미터, NaN 통과, 미등록 kind 등) 이런 테스트는 이름이 "결함 기록" 으로
 * 시작하며 임의로 기대값을 바꾸지 않는다 — 실제로 고쳐야 할 대상이다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { MapFeature, SiegeOperation } from '../src/core/types.js';
import {
    DEFAULT_SIEGE_MONTHS,
    SUPPLY_BONUS_MONTHS,
    GARRISON_ATTRITION_PER_SIEGE_MONTH,
    BESIEGER_ATTRITION_RATE,
    SIEGE_MIN_TROOPS,
    SIEGE_MIN_COMMIT_TROOPS,
    siegeDurationFor,
    checkSiegeEligibility,
    startSiege,
    advanceSiege,
} from '../src/core/map_feature_siege_system.js';
import type { SiegeStart } from '../src/core/map_feature_siege_system.js';

const MODULE_URL = new URL('../src/core/map_feature_siege_system.ts', import.meta.url);

// ============================================================
// 픽스처
// ============================================================

/** 기본 요충지 — 협곡(PASS), 수비군 3000, 무소유. */
function feature(over: Partial<MapFeature> = {}): MapFeature {
    return {
        id: 'f1',
        name: '협곡',
        kind: 'PASS',
        hexCoord: { q: 0, r: 0 },
        mapX: 0.5,
        mapY: 0.5,
        ownerId: null,
        garrison: 3000,
        maxGarrison: 3000,
        supplyRadius: 0.09,
        siegeMonthsRemaining: 0,
        besiegedByFactionId: null,
        besiegedCityIds: [],
        ...over,
    };
}

/** 기본 출진 — 5000명, 3개월 기한, ACTIVE. */
function op(over: Partial<SiegeOperation> = {}): SiegeOperation {
    return {
        id: 's1',
        factionId: 'fa',
        featureId: 'f1',
        troops: 5000,
        startTurn: 0,
        durationTurns: 3,
        status: 'ACTIVE',
        ...over,
    };
}

/** 개시 결과에서 출발 상태를 그대로 꺼낸다. */
function start(over: Partial<MapFeature> = {}, opts: { troops?: number; supply?: boolean; maxTroops?: number } = {}): SiegeStart {
    return startSiege(
        feature(over),
        'fa',
        'c1',
        opts.troops ?? 6000,
        7,
        { hasSupplyFeature: opts.supply ?? false, maxTroops: opts.maxTroops },
        's1',
    );
}

/** ACTIVE 가 끝날 때까지 진행시키고, 소요 회차와 최종 상태를 돌려준다. */
function runToEnd(s: SiegeStart, maxTurns = 30): { operation: SiegeOperation; feature: MapFeature; turns: number } {
    let o = s.operation;
    let f = s.feature;
    let turns = 0;
    for (let i = 0; i < maxTurns && o.status === 'ACTIVE'; i++) {
        const r = advanceSiege(o, f, i + 1);
        o = r.operation;
        f = r.feature;
        turns = i + 1;
    }
    return { operation: o, feature: f, turns };
}

/** 상태 문자열이 유효한 값인지 확인한다(쓰레기 상태가 새지 않는지). */
function isSiegeStatus(v: unknown): boolean {
    return v === 'ACTIVE' || v === 'SUCCEEDED' || v === 'FAILED' || v === 'BROKEN';
}

// ============================================================
// 상수 계약 — 값을 리터럴로 고정한다
// ============================================================

describe('상수 계약', () => {
    it('1. 기본 포위 개월 표가 요충지 4종을 빠짐없이 갖는다', () => {
        expect(Object.keys(DEFAULT_SIEGE_MONTHS).sort()).toEqual(['BATTLEFIELD', 'FORTRESS', 'PASS', 'PORT']);
    });

    it('2. 종류별 기본 개월이 기대값과 같다 (변경되면 회귀가 드러나야 한다)', () => {
        expect(DEFAULT_SIEGE_MONTHS.PASS).toBe(3);
        expect(DEFAULT_SIEGE_MONTHS.FORTRESS).toBe(4);
        expect(DEFAULT_SIEGE_MONTHS.BATTLEFIELD).toBe(2);
        expect(DEFAULT_SIEGE_MONTHS.PORT).toBe(2);
    });

    it('3. 모든 개월은 1 이상의 정수다 — 0 이면 즉시 함락되어 포위가 성립하지 않는다', () => {
        for (const [kind, months] of Object.entries(DEFAULT_SIEGE_MONTHS)) {
            expect(Number.isInteger(months), kind).toBe(true);
            expect(months, kind).toBeGreaterThanOrEqual(1);
        }
    });

    it('4. 감소율·임계 상수 값이 기대값과 같다', () => {
        // 문서화된 설계값(수비군 개월당 50%, 출진 매달 15%)을 그대로 고정한다.
        expect(GARRISON_ATTRITION_PER_SIEGE_MONTH).toBe(0.5);
        expect(BESIEGER_ATTRITION_RATE).toBe(0.15);
        expect(SIEGE_MIN_TROOPS).toBe(200);
        expect(SIEGE_MIN_COMMIT_TROOPS).toBe(1000);
        expect(SUPPLY_BONUS_MONTHS).toBe(2);
    });

    it('5. 모든 비율 상수는 (0,1] 범위다 — 1 이하면 매달 전멸, 0 이하면 감소가 없다', () => {
        const pairs = [
            ['GARRISON', GARRISON_ATTRITION_PER_SIEGE_MONTH],
            ['BESIEGER', BESIEGER_ATTRITION_RATE],
        ] as const;
        for (const [name, rate] of pairs) {
            expect(rate, name).toBeGreaterThan(0);
            expect(rate, name).toBeLessThanOrEqual(1);
        }
    });

    it('6. 수비군 감소율이 출진 감소율보다 크다 (수성이 더 빨리 깎인다)', () => {
        expect(GARRISON_ATTRITION_PER_SIEGE_MONTH).toBeGreaterThan(BESIEGER_ATTRITION_RATE);
    });

    it('7. 임계 병력이 출진 최소 병력보다 작다 (파산이 먼저 온다)', () => {
        expect(SIEGE_MIN_TROOPS).toBeLessThan(SIEGE_MIN_COMMIT_TROOPS);
    });
});


// ============================================================
// checkSiegeEligibility — 개시 가능 판정
// ============================================================

describe('checkSiegeEligibility 개시 판정', () => {
    /** 판정 호출을 짧게 쓰는 헬퍼. */
    function check(
        f: MapFeature,
        factionId: string,
        o: { ownerId: string | null; cx: number; cy: number; adj: number },
    ) {
        return checkSiegeEligibility(f, factionId, {
            ownerId: o.ownerId, cityMapX: o.cx, cityMapY: o.cy, adjacentDist: o.adj,
        });
    }

    it('8. 인접한 중립 요충지는 포위할 수 있다 — 사유는 빈 문자열', () => {
        const r = check(feature(), 'fa', { ownerId: null, cx: 0.52, cy: 0.5, adj: 0.1 });
        expect(r.ok).toBe(true);
        expect(r.reason).toBe('');
    });

    it('9. 거리 경계 — adjacentDist 와 정확히 같으면 통과한다 (초과일 때만 차단)', () => {
        // 요충지 (0,0), 도시 (3,4) → 거리 정확히 5.
        const f = feature({ mapX: 0, mapY: 0 });
        expect(check(f, 'fa', { ownerId: null, cx: 3, cy: 4, adj: 5 }).ok).toBe(true);
        expect(check(f, 'fa', { ownerId: null, cx: 3, cy: 4, adj: 4.999999 }).ok).toBe(false);
    });

    it('10. 거리는 피타고라스 거리다 — 대각선 방향도 정확히 잰다', () => {
        const f = feature({ mapX: 0.5, mapY: 0.5 });
        // dx=0.3, dy=0.4 → 0.5
        expect(check(f, 'fa', { ownerId: null, cx: 0.8, cy: 0.9, adj: 0.5 }).ok).toBe(true);
        expect(check(f, 'fa', { ownerId: null, cx: 0.8, cy: 0.9, adj: 0.4999 }).ok).toBe(false);
    });

    it('11. 이미 아군 소유면 막는다 — 사유 문구를 그대로 돌려준다', () => {
        const r = check(feature({ ownerId: 'fa' }), 'fa', { ownerId: 'fa', cx: 0.5, cy: 0.5, adj: 0.1 });
        expect(r).toEqual({ ok: false, reason: '이미 아군 소유다.' });
    });

    it('12. 적 소유 요충지는 막지 않는다 — 소유권만으로 거절하지 않는다', () => {
        expect(check(feature({ ownerId: 'fb' }), 'fa', { ownerId: 'fa', cx: 0.5, cy: 0.5, adj: 0.1 }).ok).toBe(true);
    });

    it('13. 다른 세력이 포위 중이면 막는다', () => {
        const r = check(feature({ besiegedByFactionId: 'fb' }), 'fa', { ownerId: null, cx: 0.5, cy: 0.5, adj: 0.1 });
        expect(r).toEqual({ ok: false, reason: '이미 다른 세력이 포위 중이다.' });
    });

    it('14. 같은 세력이 이미 포위 중이면 재개시가 허용된다', () => {
        expect(check(feature({ besiegedByFactionId: 'fa' }), 'fa', { ownerId: 'fa', cx: 0.5, cy: 0.5, adj: 0.1 }).ok).toBe(true);
    });

    it('15. 인접하지 않으면 막는다', () => {
        const r = check(feature(), 'fa', { ownerId: null, cx: 0.9, cy: 0.9, adj: 0.1 });
        expect(r).toEqual({ ok: false, reason: '인접하지 않은 요충지다.' });
    });

    it('16. 판정 순서 — 소유/포위중 사유가 인접 사유보다 먼저 나온다', () => {
        // 아군 소유 + 완전 비인접 → '아군 소유' 가 우선.
        const a = check(feature({ ownerId: 'fa' }), 'fa', { ownerId: 'fa', cx: 0.95, cy: 0.95, adj: 0.05 });
        expect(a.reason).toBe('이미 아군 소유다.');
        // 타 세력 포위 중 + 비인접 → '포위 중' 이 우선.
        const b = check(feature({ besiegedByFactionId: 'fb' }), 'fa', { ownerId: null, cx: 0.95, cy: 0.95, adj: 0.05 });
        expect(b.reason).toBe('이미 다른 세력이 포위 중이다.');
    });

    it('17. 거절 사유는 항상 비어 있지 않은 문자열이다', () => {
        const cases: Array<[string, MapFeature, string]> = [
            ['아군 소유', feature({ ownerId: 'fa' }), 'fa'],
            ['타 세력 포위', feature({ besiegedByFactionId: 'fb' }), 'fa'],
            ['비인접', feature(), 'fa'],
        ];
        for (const [name, f, fid] of cases) {
            const r = check(f, fid, { ownerId: null, cx: 0.95, cy: 0.95, adj: 0.01 });
            expect(r.ok, name).toBe(false);
            expect(typeof r.reason, name).toBe('string');
            expect(r.reason.length, name).toBeGreaterThan(0);
        }
    });

    it('18. 입력 feature 를 변경하지 않는다 (순수 판정)', () => {
        const f = feature({ ownerId: 'fa', besiegedByFactionId: 'fa', besiegedCityIds: ['c1'] });
        const before = JSON.stringify(f);
        check(f, 'fa', { ownerId: 'fa', cx: 0.9, cy: 0.9, adj: 0.1 });
        check(f, 'fb', { ownerId: 'fb', cx: 0.5, cy: 0.5, adj: 0.1 });
        expect(JSON.stringify(f)).toBe(before);
    });

    it('19. 결정론 — 같은 입력은 언제나 같은 판정을 낸다', () => {
        const f = feature({ mapX: 0.31, mapY: 0.62, garrison: 1234 });
        const args = { ownerId: 'fa', cx: 0.44, cy: 0.55, adj: 0.2 } as const;
        const a = check(f, 'fa', args);
        const b = check(f, 'fa', args);
        expect(a).toStrictEqual(b);
        expect(b).toStrictEqual(check(f, 'fa', args));
    });

    it('20. 결함 기록 — opts.ownerId 파라미터는 판정에 쓰이지 않는다', () => {
        // 도시 소유가 자기 세력이라고 선언해도 요충지가 무소유면 통과한다.
        const withOwner = checkSiegeEligibility(feature({ ownerId: null }), 'fa', {
            ownerId: 'fa', cityMapX: 0.5, cityMapY: 0.5, adjacentDist: 0.1,
        });
        const withoutOwner = checkSiegeEligibility(feature({ ownerId: null }), 'fa', {
            ownerId: null, cityMapX: 0.5, cityMapY: 0.5, adjacentDist: 0.1,
        });
        expect(withOwner).toStrictEqual(withoutOwner);
        expect(withOwner.ok).toBe(true);
    });

    it('21. 결함 기록 — NaN 좌표는 거리 비교가 false 가 되어 통과한다', () => {
        const f = feature({ mapX: Number.NaN, mapY: 0.5 });
        const r = check(f, 'fa', { ownerId: null, cx: 0.9, cy: 0.9, adj: 0.01 });
        // Math.hypot(NaN, ...) = NaN 이고 NaN > 0.01 은 false 다.
        expect(r.ok).toBe(true);
        expect(r.reason).toBe('');
    });
});



// ============================================================
// siegeDurationFor — 포위 개월 산정
// ============================================================

describe('siegeDurationFor 포위 개월', () => {
    it('22. 종류별 기본 개월이 표와 정확히 일치한다', () => {
        for (const kind of ['PASS', 'FORTRESS', 'BATTLEFIELD', 'PORT'] as const) {
            expect(siegeDurationFor(feature({ kind }), false), kind).toBe(DEFAULT_SIEGE_MONTHS[kind]);
        }
    });

    it('23. 아군 보급 요충지가 있으면 SUPPLY_BONUS_MONTHS 만큼 늘어난다', () => {
        for (const kind of ['PASS', 'FORTRESS', 'BATTLEFIELD', 'PORT'] as const) {
            const f = feature({ kind });
            expect(siegeDurationFor(f, true), kind).toBe(DEFAULT_SIEGE_MONTHS[kind] + SUPPLY_BONUS_MONTHS);
        }
    });

    it('24. 요새가 가장 오래 버티고 전장·항구가 가장 빨리 무너진다', () => {
        expect(siegeDurationFor(feature({ kind: 'FORTRESS' }), false))
            .toBeGreaterThan(siegeDurationFor(feature({ kind: 'PASS' }), false));
        expect(siegeDurationFor(feature({ kind: 'PASS' }), false))
            .toBeGreaterThan(siegeDurationFor(feature({ kind: 'BATTLEFIELD' }), false));
        expect(siegeDurationFor(feature({ kind: 'PORT' }), false))
            .toBe(siegeDurationFor(feature({ kind: 'BATTLEFIELD' }), false));
    });

    it('25. 결과는 종류·보급 여부만으로 결정된다 — 수비병력/좌표/소유권은 영향이 없다', () => {
        const base = siegeDurationFor(feature(), false);
        const noisy = siegeDurationFor(
            feature({ garrison: 0, mapX: 0.99, mapY: 0.01, ownerId: 'fb', besiegedCityIds: ['c9'] }),
            false,
        );
        expect(noisy).toBe(base);
    });

    it('26. 입력 feature 를 변경하지 않는다', () => {
        const f = feature({ kind: 'FORTRESS' });
        const before = JSON.stringify(f);
        siegeDurationFor(f, true);
        expect(JSON.stringify(f)).toBe(before);
    });
});

// ============================================================
// startSiege — 포위 개시
// ============================================================

describe('startSiege 포위 개시', () => {
    it('27. 출진 작전이 입력값을 그대로 담아 생성된다', () => {
        const s = startSiege(feature(), 'fb', 'c9', 6000, 42, { hasSupplyFeature: false }, 'op-1');
        expect(s.operation).toEqual({
            id: 'op-1', factionId: 'fb', featureId: 'f1',
            troops: 6000, startTurn: 42, durationTurns: 3, status: 'ACTIVE',
        });
    });

    it('28. 개시된 요충지에 포위 상태가 남는다', () => {
        const s = start({ kind: 'PASS' });
        expect(s.feature.siegeMonthsRemaining).toBe(3);
        expect(s.feature.besiegedByFactionId).toBe('fa');
        expect(s.feature.besiegedCityIds).toEqual(['c1']);
        expect(s.feature.ownerId).toBeNull();
    });

    it('29. 개시는 기존 포위 도시 목록을 출발 도시 1개로 교체한다', () => {
        const f = feature({ besiegedCityIds: ['old1', 'old2'], besiegedByFactionId: 'fa' });
        const s = startSiege(f, 'fa', 'c1', 6000, 0, { hasSupplyFeature: false }, 's1');
        expect(s.feature.besiegedCityIds).toEqual(['c1']);
    });

    it('30. 출진 병력이 도시 병력(maxTroops)을 넘지 못한다', () => {
        const over = startSiege(feature(), 'fa', 'c1', 9999, 0, { hasSupplyFeature: false, maxTroops: 4000 }, 's1');
        expect(over.operation.troops).toBe(4000);
        // 경계: 도시 병력과 같으면 그대로 허용된다.
        const eq = startSiege(feature(), 'fa', 'c1', 4000, 0, { hasSupplyFeature: false, maxTroops: 4000 }, 's1');
        expect(eq.operation.troops).toBe(4000);
    });

    it('31. maxTroops 가 없으면 요청한 병력이 그대로 출진된다', () => {
        expect(startSiege(feature(), 'fa', 'c1', 9999, 0, { hasSupplyFeature: false }, 's1').operation.troops).toBe(9999);
    });

    it('32. 병력은 0 미만으로 내려가지 않는다', () => {
        const neg = startSiege(feature(), 'fa', 'c1', -500, 0, { hasSupplyFeature: false }, 's1');
        expect(neg.operation.troops).toBe(0);
        const negCap = startSiege(feature(), 'fa', 'c1', -500, 0, { hasSupplyFeature: false, maxTroops: -100 }, 's1');
        expect(negCap.operation.troops).toBe(0);
    });

    it('33. 기한이 종류별 개월과 일치하고 보급 요충지가 반영된다', () => {
        expect(start({ kind: 'PORT' }).operation.durationTurns).toBe(2);
        expect(start({ kind: 'FORTRESS' }).operation.durationTurns).toBe(4);
        expect(start({ kind: 'FORTRESS' }, { supply: true }).operation.durationTurns).toBe(6);
    });

    it('34. 기한은 작전과 요충지 상태에 양쪽으로 기록된다', () => {
        const s = start({ kind: 'FORTRESS' }, { supply: true });
        expect(s.operation.durationTurns).toBe(6);
        expect(s.feature.siegeMonthsRemaining).toBe(6);
    });

    it('35. 개시 메시지에 기한과 출진 병력이 들어간다', () => {
        expect(start({ kind: 'PASS' }, { troops: 6000 }).message)
            .toBe('협곡 포위를 개시했다 (목표 3개월, 출진 6000명).');
    });

    it('36. 입력 feature 를 변경하지 않는다 (불변)', () => {
        const f = feature({ siegeMonthsRemaining: 0, besiegedByFactionId: null, besiegedCityIds: [] });
        const before = JSON.stringify(f);
        const s = startSiege(f, 'fa', 'c1', 6000, 0, { hasSupplyFeature: false }, 's1');
        expect(JSON.stringify(f)).toBe(before);
        // 결과는 새 객체이며, 중첩 배열도 공유되지 않는다.
        expect(s.feature).not.toBe(f);
        expect(s.feature.besiegedCityIds).not.toBe(f.besiegedCityIds);
    });

    it('37. 결정론 — 같은 입력은 언제나 같은 개시 결과를 낸다', () => {
        expect(start({ kind: 'FORTRESS' }, { troops: 3333, supply: true }))
            .toStrictEqual(start({ kind: 'FORTRESS' }, { troops: 3333, supply: true }));
    });

    it('38. 결함 기록 — SIEGE_MIN_COMMIT_TROOPS 미만 출진도 개시된다 (최소 출진 검사 없음)', () => {
        const s = startSiege(feature(), 'fa', 'c1', SIEGE_MIN_COMMIT_TROOPS - 1, 0, { hasSupplyFeature: false }, 's1');
        expect(s.operation.status).toBe('ACTIVE');
        expect(s.operation.troops).toBe(SIEGE_MIN_COMMIT_TROOPS - 1);
    });
});

// ============================================================
// advanceSiege — 월간 포위 진행 (정상)
// ============================================================

describe('advanceSiege 월간 진행', () => {
    it('39. 한 회차 진행하면 개월이 1 줄고 수비군이 감소한다', () => {
        const f = feature({ siegeMonthsRemaining: 3 });
        const r = advanceSiege(op({ durationTurns: 3 }), f, 1);
        expect(r.feature.siegeMonthsRemaining).toBe(2);
        expect(r.feature.garrison).toBeLessThan(f.garrison);
        expect(r.status).toBe('ACTIVE');
        expect(r.operation.status).toBe('ACTIVE');
    });

    it('40. 수비군 감소율이 50% 반올림 규칙과 같다', () => {
        // 3000 -> 1500, 1000 -> 500, 999 -> 499(499.5 반올림 500), 1001 -> 500(500.5 -> 501)
        const cases: Array<[number, number]> = [[3000, 1500], [1000, 500], [999, 499], [1001, 500], [10, 5]];
        for (const [before, expected] of cases) {
            const r = advanceSiege(op(), feature({ garrison: before, siegeMonthsRemaining: 3 }), 1);
            expect(r.feature.garrison, `garrison=${before}`).toBe(expected);
        }
    });

    it('41. 출진 병력이 매달 15% 반올림으로 감소한다', () => {
        // 10000 -> 8500, 6000 -> 5100, 5000 -> 4250
        const cases: Array<[number, number]> = [[10000, 8500], [6000, 5100], [5000, 4250]];
        for (const [before, expected] of cases) {
            const r = advanceSiege(op({ troops: before }), feature({ siegeMonthsRemaining: 3 }), 1);
            expect(r.operation.troops, `troops=${before}`).toBe(expected);
        }
    });

    it('42. 진행 메시지에 경과 개월과 남은 수비군이 들어간다', () => {
        const r = advanceSiege(op({ durationTurns: 3, troops: 6000 }), feature({ siegeMonthsRemaining: 3, garrison: 3000 }), 1);
        expect(r.message).toBe('협곡 포위 1/3개월, 수비군 1500명.');
    });

    it('43. 진행 중에는 소유권이 바뀌지 않는다', () => {
        const r = advanceSiege(op(), feature({ ownerId: 'fb', siegeMonthsRemaining: 3 }), 1);
        expect(r.feature.ownerId).toBe('fb');
        expect(r.feature.besiegedByFactionId).toBeNull();
        expect(r.feature.besiegedCityIds).toEqual([]);
    });

    it('44. 입력을 변경하지 않고 새 객체를 돌려준다', () => {
        const f = feature({ siegeMonthsRemaining: 3, besiegedByFactionId: 'fa', besiegedCityIds: ['c1'] });
        const o = op();
        const beforeF = JSON.stringify(f);
        const beforeO = JSON.stringify(o);
        const r = advanceSiege(o, f, 1);
        expect(JSON.stringify(f)).toBe(beforeF);
        expect(JSON.stringify(o)).toBe(beforeO);
        expect(r.operation).not.toBe(o);
        expect(r.feature).not.toBe(f);
    });

    it('45. 여러 개월 진행하면 개월이 계속 줄고 수비군이 계속 깎인다', () => {
        let o = op({ durationTurns: 3, troops: 6000 });
        let f = feature({ siegeMonthsRemaining: 3, garrison: 3000 });
        const months: number[] = [];
        const garrisons: number[] = [];
        for (let i = 0; i < 3 && o.status === 'ACTIVE'; i++) {
            const r = advanceSiege(o, f, i + 1);
            o = r.operation;
            f = r.feature;
            months.push(f.siegeMonthsRemaining);
            garrisons.push(f.garrison);
        }
        expect(months).toEqual([2, 1, 0]);
        expect(garrisons[0]).toBeGreaterThan(garrisons[1]);
        expect(garrisons[1]).toBeGreaterThan(garrisons[2]);
    });

    it('46. 결정론 — 같은 입력으로 진행하면 언제나 같은 결과다', () => {
        const run = (): ReturnType<typeof advanceSiege> =>
            advanceSiege(op({ troops: 4321 }), feature({ garrison: 2871, siegeMonthsRemaining: 2 }), 5);
        expect(run()).toStrictEqual(run());
    });
});

// ============================================================
// advanceSiege — 자동 함락
// ============================================================

describe('advanceSiege 자동 함락', () => {
    it('47. 남은 개월이 0 이 되면 자동 함락되어 소유권이 넘어간다', () => {
        const f = feature({ siegeMonthsRemaining: 1, garrison: 3000, besiegedByFactionId: 'fa', besiegedCityIds: ['c1'] });
        const r = advanceSiege(op({ durationTurns: 3 }), f, 3);
        expect(r.status).toBe('SUCCEEDED');
        expect(r.operation.status).toBe('SUCCEEDED');
        expect(r.feature.ownerId).toBe('fa');
        expect(r.feature.siegeMonthsRemaining).toBe(0);
        expect(r.feature.besiegedByFactionId).toBeNull();
        expect(r.feature.besiegedCityIds).toEqual([]);
    });

    it('48. 기한 만료 함락은 그 회차까지 깎인 수비군을 그대로 남긴다', () => {
        const f = feature({ siegeMonthsRemaining: 1, garrison: 3000 });
        const r = advanceSiege(op({ durationTurns: 3 }), f, 3);
        expect(r.feature.garrison).toBe(1500);
        expect(r.message).toBe('협곡을 돌격해 점령했다.');
    });

    it('49. 수비군이 먼저 0 이 되면 개월이 남아도 함락된다', () => {
        const f = feature({ siegeMonthsRemaining: 5, garrison: 1 });
        const r = advanceSiege(op({ durationTurns: 5 }), f, 1);
        expect(r.status).toBe('SUCCEEDED');
        expect(r.feature.garrison).toBe(0);
        expect(r.feature.ownerId).toBe('fa');
        expect(r.message).toBe('협곡 수비군이 소진되어 점령했다.');
    });

    it('50. 이미 수비군이 0 이면 첫 회차에 바로 점령된다', () => {
        const f = feature({ siegeMonthsRemaining: 4, garrison: 0 });
        const r = advanceSiege(op(), f, 1);
        expect(r.status).toBe('SUCCEEDED');
        expect(r.feature.garrison).toBe(0);
        expect(r.feature.ownerId).toBe('fa');
    });

    it('51. 함락 시 출진 병력은 그 회차 감소분이 반영된 값으로 남는다', () => {
        const f = feature({ siegeMonthsRemaining: 1, garrison: 3000 });
        const r = advanceSiege(op({ durationTurns: 3, troops: 6000 }), f, 3);
        expect(r.operation.troops).toBe(5100);
    });

    it('52. 함락 시 출진 세력이 소유권자가 된다', () => {
        const o = op({ factionId: 'fc' });
        const r = advanceSiege(o, feature({ ownerId: 'fb', siegeMonthsRemaining: 1 }), 1);
        expect(r.feature.ownerId).toBe('fc');
    });
});

// ============================================================
// advanceSiege — 파산
// ============================================================

describe('advanceSiege 파산', () => {
    it('53. 출진 병력이 임계 아래로 떨어지면 포위가 파산된다', () => {
        const f = feature({ siegeMonthsRemaining: 3, garrison: 3000 });
        const r = advanceSiege(op({ troops: SIEGE_MIN_TROOPS, durationTurns: 3 }), f, 1);
        expect(r.status).toBe('BROKEN');
        expect(r.operation.status).toBe('BROKEN');
    });

    it('54. 파산 경계 — 감소 후 정확히 임계이면 유지, 1 명 아래면 파산', () => {
        // 1000 -> 850 (>=200 유지), 233 -> 198(<200 파산), 235 -> 200(유지)
        const keep = advanceSiege(op({ troops: 1000 }), feature({ siegeMonthsRemaining: 3 }), 1);
        expect(keep.status).toBe('ACTIVE');
        const edge = advanceSiege(op({ troops: 235 }), feature({ siegeMonthsRemaining: 3 }), 1);
        expect(edge.operation.troops).toBe(200);
        expect(edge.status).toBe('ACTIVE');
        const below = advanceSiege(op({ troops: 233 }), feature({ siegeMonthsRemaining: 3 }), 1);
        expect(below.operation.troops).toBe(198);
        expect(below.status).toBe('BROKEN');
    });

    it('55. 파산되면 그 회차 수비군은 깎이지 않는다 (출진 소멸이 먼저)', () => {
        const f = feature({ siegeMonthsRemaining: 3, garrison: 3000 });
        const r = advanceSiege(op({ troops: 100 }), f, 1);
        expect(r.feature.garrison).toBe(3000);
    });

    it('56. 파산되면 포위 상태가 전부 해제되고 소유권은 유지된다', () => {
        const f = feature({
            ownerId: 'fb', garrison: 3000, siegeMonthsRemaining: 3,
            besiegedByFactionId: 'fa', besiegedCityIds: ['c1'],
        });
        const r = advanceSiege(op({ troops: 100 }), f, 1);
        expect(r.feature.siegeMonthsRemaining).toBe(0);
        expect(r.feature.besiegedByFactionId).toBeNull();
        expect(r.feature.besiegedCityIds).toEqual([]);
        expect(r.feature.ownerId).toBe('fb');
    });

    it('57. 파산 메시지에 요충지 이름이 들어간다', () => {
        const f = feature({ name: '망도', siegeMonthsRemaining: 3 });
        const r = advanceSiege(op({ troops: 100 }), f, 1);
        expect(r.message).toBe('포위 병력이 소진되어 망도 포위가 풀렸다.');
    });

    it('58. 판정 순서 — 출진이 파산되면 수비군이 0 이어도 점령이 아니다', () => {
        // garrison 0 이면 수비군 소멸 경로가 먼저지만, 파산 판정이 그보다 앞선다.
        const r = advanceSiege(op({ troops: 10 }), feature({ garrison: 0, siegeMonthsRemaining: 3 }), 1);
        expect(r.status).toBe('BROKEN');
        expect(r.feature.ownerId).toBeNull();
    });

    it('59. 파산된 작전은 더 진행되지 않는다', () => {
        const f = feature({ garrison: 3000, siegeMonthsRemaining: 3 });
        const broken = advanceSiege(op({ troops: 100 }), f, 1);
        const again = advanceSiege(broken.operation, broken.feature, 2);
        expect(again.status).toBe('BROKEN');
        expect(again.feature.garrison).toBe(3000);
    });
});

// ============================================================
// advanceSiege — 비활성 상태 / 경계값
// ============================================================

describe('advanceSiege 비활성 상태와 경계값', () => {
    it('60. ACTIVE 가 아니면 아무것도 바꾸지 않고 빈 메시지를 돌려준다', () => {
        for (const status of ['SUCCEEDED', 'FAILED', 'BROKEN'] as const) {
            const o = op({ status, troops: 6000 });
            const f = feature({ siegeMonthsRemaining: 3, garrison: 3000 });
            const r = advanceSiege(o, f, 9);
            expect(r.status, status).toBe(status);
            expect(r.message, status).toBe('');
            expect(r.operation, status).toBe(o);
            expect(r.feature, status).toBe(f);
            expect(r.operation.troops, status).toBe(6000);
            expect(r.feature.garrison, status).toBe(3000);
            expect(r.feature.siegeMonthsRemaining, status).toBe(3);
        }
    });

    it('61. 남은 개월이 0 인 상태로 진행하면 즉시 함락된다 (경계 0)', () => {
        const r = advanceSiege(op({ durationTurns: 3 }), feature({ siegeMonthsRemaining: 0, garrison: 3000 }), 1);
        expect(r.status).toBe('SUCCEEDED');
        expect(r.feature.ownerId).toBe('fa');
        expect(r.feature.siegeMonthsRemaining).toBe(0);
    });

    it('62. 남은 개월이 음수(데이터 손상)여도 함락으로 수렴한다', () => {
        const r = advanceSiege(op({ durationTurns: 3 }), feature({ siegeMonthsRemaining: -5, garrison: 3000 }), 1);
        expect(r.status).toBe('SUCCEEDED');
        expect(r.feature.ownerId).toBe('fa');
        expect(r.feature.siegeMonthsRemaining).toBe(0);
    });

    it('63. 출진 병력이 0 이어도 파산으로 수렴하고 음수되지 않는다', () => {
        const r = advanceSiege(op({ troops: 0 }), feature({ siegeMonthsRemaining: 3 }), 1);
        expect(r.status).toBe('BROKEN');
        expect(r.operation.troops).toBe(0);
    });

    it('64. 음수 출진 병력도 0 으로 보정되어 파산된다', () => {
        const r = advanceSiege(op({ troops: -1000 }), feature({ siegeMonthsRemaining: 3 }), 1);
        expect(r.status).toBe('BROKEN');
        expect(r.operation.troops).toBe(0);
    });

    it('65. 음수 수비군은 0 으로 보정되어 즉시 함락된다', () => {
        const r = advanceSiege(op(), feature({ garrison: -100, siegeMonthsRemaining: 3 }), 1);
        expect(r.status).toBe('SUCCEEDED');
        expect(r.feature.garrison).toBe(0);
    });

    it('66. 아주 큰 출진 병력도 오버플로 없이 안전하게 감소한다', () => {
        const r = advanceSiege(op({ troops: 1e12 }), feature({ siegeMonthsRemaining: 3 }), 1);
        expect(r.operation.troops).toBe(1e12 - 1.5e11);
        expect(Number.isFinite(r.operation.troops)).toBe(true);
    });

    it('67. turn 인자는 계산에 쓰이지 않는다 (결정론)', () => {
        const f = feature({ siegeMonthsRemaining: 3, garrison: 3000 });
        const o = op({ troops: 6000 });
        const a = advanceSiege(o, f, 1);
        const b = advanceSiege(o, f, 999);
        expect(a).toStrictEqual(b);
    });
});

// ============================================================
// 데이터 충격 방어 — 비정상 입력에도 예외 없이 수렴한다
// ============================================================

describe('데이터 충격 방어', () => {
    it('68. 비정상 수치 입력에 예외를 던지지 않는다', () => {
        const weird: Array<[string, number]> = [
            ['NaN', Number.NaN],
            ['Infinity', Number.POSITIVE_INFINITY],
            ['-Infinity', Number.NEGATIVE_INFINITY],
            ['0', 0],
            ['-0', -0],
            ['소수', 1234.5678],
        ];
        for (const [name, v] of weird) {
            expect(() => advanceSiege(op({ troops: v }), feature({ garrison: v, siegeMonthsRemaining: 3 }), 1), `troops ${name}`)
                .not.toThrow();
            expect(() => advanceSiege(op(), feature({ garrison: v, siegeMonthsRemaining: v }), 1), `garrison ${name}`)
                .not.toThrow();
            expect(() => startSiege(feature(), 'fa', 'c1', v, 0, { hasSupplyFeature: false }, 's1'), `start ${name}`)
                .not.toThrow();
            expect(() => checkSiegeEligibility(feature({ mapX: v, mapY: v }), 'fa', {
                ownerId: null, cityMapX: v, cityMapY: 0.5, adjacentDist: v,
            }), `eligibility ${name}`).not.toThrow();
        }
    });

    it('69. 결과 상태는 항상 유효한 상태 문자열이다', () => {
        const inputs = [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, 0, 1, 1e9];
        for (const v of inputs) {
            for (const months of [Number.NaN, -3, 0, 1, 5]) {
                const r = advanceSiege(op({ troops: v }), feature({ garrison: v, siegeMonthsRemaining: months }), 1);
                expect(isSiegeStatus(r.status), `troops=${v} months=${months}`).toBe(true);
                expect(isSiegeStatus(r.operation.status), `op troops=${v} months=${months}`).toBe(true);
                expect(typeof r.message).toBe('string');
            }
        }
    });

    it('70. 포위가 종료되면 개월과 포위 플래그가 항상 유한하고 0 으로 수렴한다', () => {
        // NaN/Infinity 는 종료되지 않으므로(결함 71 참조) 수렴 가능한 값만 검사한다.
        for (const v of [-50, -1, 0, 1, 100]) {
            const r = advanceSiege(op({ troops: v }), feature({ garrison: v, siegeMonthsRemaining: 2 }), 1);
            expect(isSiegeStatus(r.status), `troops=${v}`).toBe(true);
            expect(r.status, `troops=${v}`).not.toBe('ACTIVE');
            expect(Number.isFinite(r.feature.siegeMonthsRemaining), `troops=${v}`).toBe(true);
            expect(r.feature.siegeMonthsRemaining, `troops=${v}`).toBe(0);
            expect(r.feature.besiegedByFactionId, `troops=${v}`).toBeNull();
            expect(Array.isArray(r.feature.besiegedCityIds), `troops=${v}`).toBe(true);
            expect(r.feature.besiegedCityIds.length, `troops=${v}`).toBe(0);
        }
    });

    it('70-2. 무한 출진도 종료되지는 않지만 유효 상태를 유지한다', () => {
        // Infinity - Infinity = NaN 이므로 파산 조건을 통과한다(결함 71 과 같은 원인).
        const r = advanceSiege(op({ troops: Number.POSITIVE_INFINITY }), feature({ siegeMonthsRemaining: 2 }), 1);
        expect(isSiegeStatus(r.status)).toBe(true);
        expect(Number.isNaN(r.operation.troops)).toBe(true);
    });

    it('71. 결함 기록 — NaN 출진 병력은 파산되지 않고 NaN 이 전파된다', () => {
        // Math.round(NaN * 0.15) = NaN, Math.max(0, NaN) = NaN, NaN < 200 은 false 다.
        const r = advanceSiege(op({ troops: Number.NaN }), feature({ siegeMonthsRemaining: 3 }), 1);
        expect(r.status).toBe('ACTIVE');
        expect(Number.isNaN(r.operation.troops)).toBe(true);
    });

    it('72. 결함 기록 — NaN 수비군은 0 으로 보정되지 않는다', () => {
        const r = advanceSiege(op(), feature({ garrison: Number.NaN, siegeMonthsRemaining: 3 }), 1);
        expect(Number.isNaN(r.feature.garrison)).toBe(true);
        expect(r.status).toBe('ACTIVE');
    });

    it('73. 결함 기록 — 미등록 kind 는 개월이 NaN 이 된다', () => {
        // 저장소가 오염되면 kind 가 표에 없는 값으로 들어올 수 있다.
        const bad = { ...feature(), kind: 'TOWER' } as unknown as MapFeature;
        expect(Number.isNaN(siegeDurationFor(bad, false))).toBe(true);
    });

    it('74. 빈 배열/빈 문자열 같은 빈 값 입력도 안전하다', () => {
        const f = feature({ name: '', besiegedCityIds: [], siegeMonthsRemaining: 3 });
        const r = advanceSiege(op(), f, 1);
        expect(r.status).toBe('ACTIVE');
        expect(r.message).toContain('');
        const s = startSiege(f, '', '', 0, 0, { hasSupplyFeature: false }, '');
        expect(s.operation.troops).toBe(0);
        expect(s.operation.status).toBe('ACTIVE');
    });
});

// ============================================================
// 전체 시나리오
// ============================================================

describe('전체 시나리오', () => {
    it('75. 충분한 출진이면 기한 내 점령한다', () => {
        const r = runToEnd(start({ kind: 'PASS', garrison: 3000 }, { troops: 6000 }));
        expect(r.operation.status).toBe('SUCCEEDED');
        expect(r.turns).toBe(3);
        expect(r.feature.ownerId).toBe('fa');
        expect(r.feature.besiegedByFactionId).toBeNull();
        expect(r.feature.siegeMonthsRemaining).toBe(0);
    });

    it('76. 약한 출진이면 기한 전에 파산되어 소유권이 넘어가지 않는다', () => {
        const r = runToEnd(start({ kind: 'PASS', garrison: 3000 }, { troops: 300 }));
        expect(r.operation.status).toBe('BROKEN');
        expect(r.feature.ownerId).toBeNull();
        expect(r.feature.siegeMonthsRemaining).toBe(0);
        // 파산은 3개월차(300 -> 255 -> 217 -> 184)다. 앞선 2개월치 감소는 이미 반영됐다.
        expect(r.feature.garrison).toBe(750);
    });

    it('77. 병력 규모가 결과를 가른다 — 같은 요충지·같은 기한', () => {
        expect(runToEnd(start({ kind: 'PASS' }, { troops: 300 })).operation.status).toBe('BROKEN');
        expect(runToEnd(start({ kind: 'PASS' }, { troops: 4000 })).operation.status).toBe('SUCCEEDED');
    });

    it('78. 보급 요충지가 있으면 더 오래 버텨서 함락 시점이 늦어진다', () => {
        const bare = runToEnd(start({ kind: 'PASS' }, { troops: 6000, supply: false }));
        const supplied = runToEnd(start({ kind: 'PASS' }, { troops: 6000, supply: true }));
        expect(bare.turns).toBe(3);
        expect(supplied.turns).toBe(5);
        expect(supplied.feature.ownerId).toBe('fa');
    });

    it('79. 수비군이 1 명이면 기한과 무관하게 첫 회차에 조기 함락한다', () => {
        const s = start({ kind: 'FORTRESS', garrison: 1 }, { troops: 20000 });
        const first = advanceSiege(s.operation, s.feature, 1);
        expect(first.status).toBe('SUCCEEDED');
        expect(first.feature.garrison).toBe(0);
        expect(first.message).toContain('수비군이 소진되어');
    });

    it('80. 포위 종료 후에는 더 이상 상태가 변하지 않는다 (멱등)', () => {
        const done = runToEnd(start({ kind: 'PASS' }, { troops: 6000 }));
        const again = advanceSiege(done.operation, done.feature, done.turns + 5);
        expect(JSON.stringify(again.operation)).toBe(JSON.stringify(done.operation));
        expect(JSON.stringify(again.feature)).toBe(JSON.stringify(done.feature));
        expect(again.message).toBe('');
    });

    it('81. 개시 → 진행 전체 파이프라인이 결정론적이다', () => {
        const run = (): { operation: SiegeOperation; feature: MapFeature } => {
            const s = startSiege(
                feature({ kind: 'FORTRESS', garrison: 2500, mapX: 0.42, mapY: 0.61 }),
                'fa', 'c1', 5000, 11, { hasSupplyFeature: true, maxTroops: 8000 }, 'op-x',
            );
            let o = s.operation;
            let f = s.feature;
            for (let i = 0; i < 20 && o.status === 'ACTIVE'; i++) {
                const r = advanceSiege(o, f, i + 1);
                o = r.operation;
                f = r.feature;
            }
            return { operation: o, feature: f };
        };
        const a = run();
        expect(a).toStrictEqual(run());
        expect(run()).toStrictEqual(run());
    });

    it('82. 소스에 난수·시각 생성기가 쓰이지 않는다 (주석 제외)', () => {
        const source = readFileSync(MODULE_URL, 'utf8');
        const code = source
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\n]*/g, '');
        expect(code).not.toMatch(/Math\s*\.\s*random/);
        expect(code).not.toMatch(/Date\s*\.\s*now/);
        expect(code).not.toMatch(/performance\s*\.\s*now/);
        expect(code).not.toMatch(/new\s+Date\b/);
    });
});

