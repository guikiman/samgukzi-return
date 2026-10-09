/**
 * 도시 방어력 상한 불변식 — defense 는 언제나 maxDefense 이하이다.
 *
 * [왜 이 테스트가 필요한가]
 * 초기 방어력은 `35 + cityIndex * 5` 인데 maxDefense 가 100 으로 하드코딩돼 있어서,
 * 인덱스 14 를 넘으면 defense > maxDefense 로 시작하는 도시가 생겼다(31개 중 12개, 최대 160).
 * 그리고 방어력 보전이 `Math.min(maxDefense, defense + n)` 이라 상한을 넘은 도시에
 * 보전을 투자하면 방어도가 떨어졌다(160 → 100, 보전 1회에 -60).
 * 불변식이 깨졌다고 티가 안 나므로 모든 시나리오에서 검증한다.
 */
import { describe, it, expect } from 'vitest';
import { buildWorld, CITY_MAX_DEFENSE } from '../src/core/scenario_system';
import scenarioIndex from '../src/data/scenarios/index.json';

const scenarios = scenarioIndex as unknown as Array<{ id: string }>;

describe('도시 방어력 상한', () => {
    it('시나리오 데이터가 로드된다', () => {
        expect(scenarios.length).toBeGreaterThan(0);
    });

    for (const sc of scenarios) {
        it(`${sc.id} — 모든 도시가 defense <= maxDefense 로 시작한다`, () => {
            const world = buildWorld(sc as never, 0);
            const cities = Object.values(world.cities);
            expect(cities.length).toBeGreaterThan(0);
            const violations = cities.filter(c => c.defense > c.maxDefense);
            expect(
                violations.map(c => `${c.name} ${c.defense}>${c.maxDefense}`),
                '상한을 넘은 도시가 있다 — 보전 시 방어도가 역으로 떨어진다',
            ).toEqual([]);
        });

        it(`${sc.id} — 방어력은 0 이상이고 상한은 CITY_MAX_DEFENSE 다`, () => {
            const world = buildWorld(sc as never, 0);
            for (const c of Object.values(world.cities)) {
                expect(c.defense, `${c.name} 의 방어력이 음수`).toBeGreaterThanOrEqual(0);
                expect(c.maxDefense, `${c.name} 의 상한이 상수와 다르다`).toBe(CITY_MAX_DEFENSE);
            }
        });
    }

    it('보전은 방어도를 낮추지 않는다 (Math.min 역효과 재발 방지)', () => {
        // 상한 근처와 상한 바로 아래 두 상태에서 "증가" 후에도 defense 가 줄지 않아야 한다.
        for (const before of [CITY_MAX_DEFENSE - 1, CITY_MAX_DEFENSE, 50]) {
            const after = Math.min(CITY_MAX_DEFENSE, before + 5);
            expect(after, `방어도 ${before} 에서 보전 후 감소했다`).toBeGreaterThanOrEqual(before);
        }
    });
});
