import { describe, it, expect } from 'vitest';
import {
    areCitiesAdjacent,
    getAdjacentFriendlyCities,
    assembleReinforcements,
    canAttackFrom,
} from '../src/core/reinforcement_system';
import type { City, Officer, Army } from '../src/core/types';
import { buildWorld, CITY_MAP_COORDS } from '../src/core/scenario_system';
import scenarioIndex from '../src/data/scenarios/index.json';

// ============================================================
// 테스트용 픽스처 생성 헬퍼
// ============================================================

let seq = 0;
function makeCity(
    id: string,
    name: string,
    ownerId: string | null,
    population = 50000,
    mapX?: number,
    mapY?: number,
): City {
    return {
        id,
        name,
        hexCoord: { q: seq++, r: 0 },
        mapX,
        mapY,
        population,
        defense: 100,
        maxDefense: 100,
        goldIncome: 10,
        foodIncome: 10,
        funds: 500,
        facilities: [],
        officerIds: [],
        ownerId,
        isCapital: false,
        development: 30,
        developmentStats: {
            commerce: 30,
            maxCommerce: 100,
            farming: 30,
            maxFarming: 100,
            technology: 30,
            maxTechnology: 100,
            publicOrder: 50,
            maxPublicOrder: 100,
        },
        loyalty: 70,
        danger: 0,
        weather: '맑음' as City['weather'],
    };
}

function makeOfficer(id: string, name: string, cityId: string | null, factionId: string | null, leadership = 70): Officer {
    return {
        id,
        name,
        courtesy: '공',
        factionId,
        cityId,
        rank: 'GENERAL' as Officer['rank'],
        status: 'ACTIVE' as Officer['status'],
        stats: { leadership, might: 60, intelligence: 60, politics: 60, charisma: 60 },
        loyalty: 80,
        ambition: 3,
        gold: 100,
        fame: 100,
        age: 30,
        isPlayerControlled: false,
    } as unknown as Officer;
}

function makeArmy(id: string, commanderId: string, originCityId: string, soldiers: number): Army {
    return {
        id,
        commanderId,
        officerIds: [commanderId],
        soldiers,
        morale: 80,
        training: 70,
        supplies: 100,
        originCityId,
        targetCityId: null,
        position: null,
        banner: 'test',
    };
}

// ============================================================
// 인접 판정
// ============================================================

describe('도시 인접 판정', () => {
    it('허창-업은 인접으로 판정된다', () => {
        expect(areCitiesAdjacent('허창', '업')).toBe(true);
    });

    it('허창-건업은 인접하지 않다', () => {
        expect(areCitiesAdjacent('허창', '건업')).toBe(false);
    });

    it('같은 도시는 인접이 아니다', () => {
        expect(areCitiesAdjacent('허창', '허창')).toBe(false);
    });

    it('출진 가능 판정도 인접 판정과 동일하다', () => {
        expect(canAttackFrom('허창', '낙양')).toBe(true);
        expect(canAttackFrom('허창', '오')).toBe(false);
    });

    // ── 회귀: 게임은 이름이 아니라 'city_이름' id 로 호출한다 ──
    // 아래가 없으면 표 키를 이름으로만 맞춰 둔 구현이 그대로 통과해 버린다.
    it('도시 id(city_낙양)로 불러도 이름과 똑같이 판정한다', () => {
        for (const [a, b] of [['허창', '업'], ['허창', '건업'], ['낙양', '진류']] as const) {
            expect(areCitiesAdjacent(`city_${a}`, `city_${b}`), `${a}-${b}`).toBe(
                areCitiesAdjacent(a, b),
            );
        }
    });

    it('중복 도시명용 접미사 id(city_낙양_3)도 좌표를 찾는다', () => {
        expect(areCitiesAdjacent('city_낙양_3', 'city_허창_7')).toBe(
            areCitiesAdjacent('낙양', '허창'),
        );
    });

    it('표에 없는 도시는 조용히 인접하지 않은 것으로 본다', () => {
        expect(areCitiesAdjacent('존재하지않는도시', 'city_허창')).toBe(false);
        expect(areCitiesAdjacent('city_존재하지않는도시', 'city_허창')).toBe(false);
    });

    it('임계값 경계에 걸린 도시 쌍도 인접으로 판정한다 (부동소수 오차 회귀)', () => {
        // 허창(0.60,0.40) - 업(0.60,0.24) = 0.16 으로 딱 임계값이다.
        // 0.40 - 0.24 를 계산하면 0.16000000000000003 이 되어
        // 여유 없이 비교하면 인접인 쌍을 떨어뜨린다.
        expect(areCitiesAdjacent('허창', '업')).toBe(true);
    });
});

// ============================================================
// 인접 아군 도시 조회
// ============================================================

describe('인접 아군 도시 조회', () => {
    it('같은 세력의 인접 도시만 반환한다', () => {
        const cities = [
            makeCity('허창', '허창', 'fac_1', 50000, 0.55, 0.3),
            makeCity('낙양', '낙양', 'fac_1', 50000, 0.5, 0.35),
            makeCity('서주', '서주', 'fac_2', 50000, 0.7, 0.4),
        ];
        const result = getAdjacentFriendlyCities('허창', 'fac_1', cities);
        expect(result.map((c) => c.id)).toContain('낙양');
        expect(result.map((c) => c.id)).not.toContain('서주');
    });

    it('다른 세력 도시는 아군으로 세지 않는다', () => {
        const cities = [
            makeCity('허창', '허창', 'fac_1', 50000, 0.55, 0.3),
            makeCity('낙양', '낙양', 'fac_2', 50000, 0.5, 0.35),
        ];
        const result = getAdjacentFriendlyCities('허창', 'fac_1', cities);
        expect(result).toHaveLength(0);
    });
});

// ============================================================
// 증원 편성
// ============================================================

describe('증원 편성', () => {
    it('인접 아군 도시에서 병력과 무장을 파견한다', () => {
        const cities = [
            makeCity('허창', '허창', 'fac_1'),
            makeCity('낙양', '낙양', 'fac_1'),
        ];
        const officers = [
            makeOfficer('o1', '하후돈', '낙양', 'fac_1', 90),
            makeOfficer('o2', '하후연', '낙양', 'fac_1', 85),
            makeOfficer('o3', '순욱', '낙양', 'fac_1', 40),
        ];
        const armies = [makeArmy('a1', 'o1', '낙양', 3000)];

        const result = assembleReinforcements('허창', 'fac_1', cities, officers, armies);

        expect(result.totalTroops).toBe(3000);
        expect(result.contingents[0].sourceCityId).toBe('낙양');
        // 통솔 높은 순 최대 2명, 1명은 도시에 잔류
        expect(result.officerIds).toContain('o1');
        expect(result.officerIds).toContain('o2');
        expect(result.officerIds).not.toContain('o3');
    });

    it('부대가 없는 도시는 인구 기반 소규모 지원군을 편성한다', () => {
        const cities = [
            makeCity('허창', '허창', 'fac_1'),
            makeCity('낙양', '낙양', 'fac_1', 50000),
        ];
        const officers = [makeOfficer('o1', '관우', '낙양', 'fac_1', 95)];
        const result = assembleReinforcements('허창', 'fac_1', cities, officers, []);
        // 인구 50,000 × 2% = 1,000명
        expect(result.totalTroops).toBe(1000);
        // 무장 1명뿐이면 도시에 1명은 남아야 하므로 파견 0명
        expect(result.officerIds).toHaveLength(0);
    });

    it('방어 도시가 없으면 증원 0', () => {
        const cities = [makeCity('허창', '허창', 'fac_1')];
        const result = assembleReinforcements('허창', 'fac_1', cities, [], []);
        expect(result.totalTroops).toBe(0);
        expect(result.contingents).toHaveLength(0);
    });

    it('적 세력 소유 도시로는 증원하지 않는다', () => {
        const cities = [
            makeCity('허창', '허창', 'fac_1'),
            makeCity('낙양', '낙양', 'fac_2'),
        ];
        const officers = [makeOfficer('o1', '여포', '낙양', 'fac_2', 95)];
        const result = assembleReinforcements('허창', 'fac_1', cities, officers, []);
        expect(result.totalTroops).toBe(0);
    });

    // ── 회귀: 게임은 이름이 아니라 id 로 부른다 ──
    // 위 테스트들은 전부 '허창' 처럼 이름으로만 픽스처를 만들어서,
    // "이름이 id 를 대신하던" 원래 결함을 통과시켜 버렸다.
    it('city_ 접두사가 붙은 id 로도 같은 결과를 낸다', () => {
        const cities = [
            makeCity('city_허창', '허창', 'fac_1'),
            makeCity('city_낙양', '낙양', 'fac_1'),
            makeCity('city_서주', '서주', 'fac_2'),
        ];
        const officers = [
            makeOfficer('o1', '하후돈', 'city_낙양', 'fac_1', 90),
            makeOfficer('o2', '하후연', 'city_낙양', 'fac_1', 85),
            makeOfficer('o3', '순욱', 'city_낙양', 'fac_1', 40),
        ];
        const armies = [makeArmy('a1', 'o1', 'city_낙양', 3000)];

        const result = assembleReinforcements('city_허창', 'fac_1', cities, officers, armies);

        expect(result.totalTroops).toBe(3000);
        expect(result.contingents[0].sourceCityId).toBe('city_낙양');
        expect(result.officerIds).toEqual(['o1', 'o2']);
    });
});

// ============================================================
// 실제 시나리오 데이터와의 계약
// ============================================================

describe('실제 시나리오와의 계약', () => {
    const index = scenarioIndex as ReadonlyArray<{ id: string; title_kr: string }>;

    it('모든 시나리오의 모든 도시가 좌표 표에서 조회된다', () => {
        // 표에 없는 도시는 조용히 인접하지 않은 것으로 취급되므로
        // 표 누락이 있으면 "기능이 조용히 꺼진다" 형태로만 드러난다.
        const missing: string[] = [];
        for (const s of index) {
            const world = buildWorld(s as never, 0);
            for (const c of world.cities) {
                const name = c.id.replace(/^city_/, '').replace(/_\d+$/, '');
                if (!CITY_MAP_COORDS[name]) missing.push(`${s.id}:${c.id}`);
            }
        }
        expect(missing).toEqual([]);
    });

    it('도시가 둘 이상인 세력이 있으면 실제 증원이 발생한다', () => {
        // 원래 결함 상태에서는 모든 시나리오에서 증원 병력이 0 이었다.
        // 전 시나리오가 0 이면 기능이 꺼져 있다는 뜻이므로 실패시켜야 한다.
        let totalTroops = 0;
        for (const s of index) {
            const world = buildWorld(s as never, 0);
            for (const c of world.cities) {
                if (!c.ownerId) continue;
                totalTroops += assembleReinforcements(
                    c.id, c.ownerId, world.cities, world.officers, world.armies ?? [],
                ).totalTroops;
            }
        }
        expect(totalTroops).toBeGreaterThan(0);
    });

    // ── [결함 수정] 아래 계약이 없으면 데이터 결함이 조용히 통과된다 ──
    // 7개 시나리오 중 6개가 2차도시 0개(세력당 1도시)였고,
    // 세력 간 접경이 0쌍이어서 AI가 24개월 내내 공격 0회였다.
    // 병력(development)이 0~100 개발도로 시작해 1.2배 열세 조건이
    // 구조적으로 불가능했고, 징병도 1명도 늘어나지 않았다.

    const ADJACENT = 0.16;

    it('모든 시나리오에서 세력당 도시가 2개 이상이다', () => {
        // 세력당 1도시면 "점령"이 일어나도 상대 세력이 즉시 소멸한다.
        for (const s of index) {
            const world = buildWorld(s as never, 2);
            const perFaction = new Map<string, number>();
            for (const c of world.cities) {
                perFaction.set(c.ownerId ?? '중립', (perFaction.get(c.ownerId ?? '중립') ?? 0) + 1);
            }
            for (const [fid, n] of perFaction) {
                expect(n, `${s.id} ${s.title_kr} ${fid} 도시 ${n}개`).toBeGreaterThanOrEqual(2);
            }
        }
    });

    it('모든 시나리오에 세력 간 접경이 존재한다 (AI 공격 불가 방지)', () => {
        for (const s of index) {
            const world = buildWorld(s as never, 2);
            let borders = 0;
            for (let i = 0; i < world.cities.length; i++) {
                for (let j = i + 1; j < world.cities.length; j++) {
                    const a = world.cities[i], b = world.cities[j];
                    if (!a.ownerId || !b.ownerId || a.ownerId === b.ownerId) continue;
                    const d = Math.hypot((a.mapX ?? 0) - (b.mapX ?? 0), (a.mapY ?? 0) - (b.mapY ?? 0));
                    if (d <= ADJACENT) borders++;
                }
            }
            expect(borders, `${s.id} ${s.title_kr} 세력 간 접경 0쌍 — AI가 공격할 수 없음`).toBeGreaterThan(0);
        }
    });

    it('도시 병력(development)이 병력 규모다 — 0~100 개발도가 아니다', () => {
        // 0~100 으로 시작하면 징병 후 전원이 700 근처로 평준화돼
        // 출진 열세(1.2배)가 영영 성립하지 않는다.
        for (const s of index) {
            const world = buildWorld(s as never, 2);
            for (const c of world.cities) {
                expect(c.development, `${s.id} ${c.name} 병력 ${c.development}`)
                    .toBeGreaterThanOrEqual(400);
            }
        }
    });
});

