/**
 * [08] 전장태세 시나리오 계약 — 세 가지 요구를 고정한다.
 *   1) 모든 "네임드" 무장이 등장한다 (미등장/무효 껍데기 행은 제외)
 *   2) 전국지도의 주요 도시 57개가 전부 나온다
 *   3) 역사적 시기와 무관하다 (historical_mode = false, 어떤 연도든 성립)
 *
 * 소유권: 이 테스트는 tests/scenario_allstar.test.ts 단독 소유.
 *        src/data/scenarios/index.json 은 읽기 전용으로만 쓴다.
 */
import { describe, it, expect } from 'vitest';
import scenarioIndex from '../src/data/scenarios/index.json';
import officersFull from '../src/data/officers_full.json';
import mapCoords from '../assets/map-coordinates-4096.json';
import { buildWorld, type ScenarioData } from '../src/core/scenario_system';

const ALL = scenarioIndex as ScenarioData[];
const s08 = ALL.find(s => s.id === '08')!;
const world = buildWorld(s08, 0);
const profiles = officersFull.profiles as Record<string, { name: string; statusLabel: string }>;

describe('[08] 전장태세 — 시나리오가 목록에 있다', () => {
    it('존재하고 활성화 상태다', () => {
        expect(s08, '08 시나리오가 없다').toBeDefined();
        expect(s08.status).toBe('active');
        expect(s08.title_kr.length).toBeGreaterThan(0);
    });

    it('역사적 시기 제약을 걸지 않는다', () => {
        // historical_mode 가 true 면 시나리오가 특정 연도에만 성립하는 판정으로 들어간다.
        expect(s08.special_conditions.historical_mode).toBe(false);
    });

    it('특전 시나리오임을 설명이 밝힌다', () => {
        expect(s08.description, '특전 시나리오임을 설명에 명시해야 한다').toContain('특전');
    });

    it('설명 인원수가 실제 등장 인원수와 같다', () => {
        const named = Object.values(profiles).filter(p => p.statusLabel !== '미등장' && p.statusLabel !== '무효');
        const mentioned = Number(/무장 (\d+)명/.exec(s08.description)?.[1] ?? NaN);
        expect(Number.isFinite(mentioned), '설명에 무장 인원수가 없다').toBe(true);
        expect(mentioned, `설명은 ${mentioned}명이라 하지만 데이터는 ${named.length}명이다`).toBe(named.length);
    });
});

describe('[08] 전장태세 — 전국 주요 도시 57개가 전부 나온다', () => {
    it('도시 수가 지도 좌표 수와 같다', () => {
        expect(world.cities.length).toBe(mapCoords.cities.length);
        expect(world.cities.length).toBe(57);
    });

    it('지도에 있는 도시를 하나도 빠뜨리지 않는다', () => {
        const built = new Set(world.cities.map(c => c.name));
        const missing = mapCoords.cities.filter(c => !built.has(c.name)).map(c => c.name);
        expect(missing, '지도에 있는데 월드에 없는 도시').toEqual([]);
    });

    it('맵에 그려질 좌표(imageX/imageY)를 전부 갖는다', () => {
        // 앵커가 없으면 buildWorld 가 전술 좌표로 대체하고 console.warn 을 남긴다.
        // 그 경로로 그려진 도시는 지도 위 엉뚱한 자리에 놓인다.
        const bad = world.cities.filter(c =>
            !Number.isFinite(c.mapImageX) || !Number.isFinite(c.mapImageY)
            || c.mapImageX < 0 || c.mapImageX > 1 || c.mapImageY < 0 || c.mapImageY > 1);
        expect(bad.map(c => c.name)).toEqual([]);
    });

    it('모든 도시는 어떤 세력에 속한다', () => {
        const owned = world.cities.filter(c => c.ownerId);
        expect(owned.length).toBe(world.cities.length);
        expect(new Set(world.cities.map(c => c.ownerId)).size).toBe(world.factions.length);
    });
});

describe('[08] 전장태세 — 네임드 무장이 전원 등장한다', () => {
    // 미등장/무효 는 "이 게임에 나오지 않는" 행이다(예: '오환재상').
    const REAL_STATUS = new Set(['일반', '재야', '군주', '태수', '도독', '미발견']);
    const namedIds = Object.keys(profiles).filter(id => REAL_STATUS.has(profiles[id].statusLabel));

    it('데이터에 있는 실명 무장이 300명 이상이다 (전제 확인)', () => {
        expect(namedIds.length).toBeGreaterThanOrEqual(300);
    });

    it('실명 무장이 전부 월드에 들어 있다', () => {
        const inWorld = new Set(world.officers.map(o => o.id));
        const missing = namedIds.filter(id => !inWorld.has(id));
        // 예전엔 "나머지만큼은 잘려도 된다" 를 허용했는데, 특전 시나리오의 계약은
        // 전원 등장이다. 여유분을 허용하면 인원이 조용히 줄어도 테스트가 통과한다.
        expect(missing, `${missing.length}명이 누락: ${missing.slice(0, 10).join(',')}`).toEqual([]);
        expect(inWorld.size).toBe(namedIds.length);
    });

    it('무장 이름이 전부 한글로 나온다 (id 가 그대로 노출되지 않는다)', () => {
        // buildOfficer 는 이름표에 없으면 id 를 이름으로 쓴다 → "off_0521" 이 화면에 나온다.
        const bad = world.officers.filter(o => /^off_\d+$/.test(o.name));
        expect(bad.map(o => o.id), '이름이 아니라 ID 가 이름으로 표시된다').toEqual([]);
    });

    it('모든 무장이 능력치를 갖는다 (0 이 아니라 실제 값)', () => {
        const zero = world.officers.filter(o => {
            const s = o.stats;
            return (s.leadership + s.might + s.intelligence) <= 0;
        });
        expect(zero.map(o => o.id)).toEqual([]);
    });

    it('무장 ID 가 중복되지 않는다', () => {
        const ids = world.officers.map(o => o.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('세력마다 군주가 있고 그 군주가 해당 세력 소속이다', () => {
        for (const f of world.factions) {
            expect(f.officers.length, `${f.name} 무장 없음`).toBeGreaterThan(0);
            expect(f.cities.length, `${f.name} 도시 없음`).toBeGreaterThan(0);
        }
        for (const o of world.officers.filter(o => o.status === 'LORD')) {
            const f = world.factions.find(x => x.id === o.factionId);
            expect(f, `군주 ${o.id} 의 세력이 없다`).toBeDefined();
            expect(f!.leaderId).toBe(o.id);
        }
    });
});

describe('[08] 전장태세 — 나이·시대에 얽매이지 않는다', () => {
    it('어떤 연도로 시작해도 무장이 사라지지 않는다', () => {
        // 나이 필터가 걸리면 시작 연도가 바뀌었을 때 인원이 달라진다.
        // 08 은 "나이에 관계 없이 전부 등장" 이므로 어떤 연도에서도 명단이 같아야 한다.
        const baseline = buildWorld(s08, 0).officers.map(o => o.id).sort();
        for (const year of [190, 200, 220, 260, 299]) {
            const ids = buildWorld(s08, year).officers.map(o => o.id).sort();
            expect(ids, `${year}년 시작에서 무장 명단이 달라졌다`).toEqual(baseline);
        }
    });

    it('시작 시점에 이미 죽은 무장이 없다', () => {
        // 원본 officers_full.json 의 deathYear 를 그대로 쓰면 220년에 시작하는 08 에서
        // 이미 사망한 무장이 생긴다. 특전 시나리오는 전원을 살려 둔다.
        const dead = world.officers.filter(o => !o.runtime.isAlive);
        expect(dead.map(o => o.id)).toEqual([]);
    });

    it('성향이 단일값으로 뭉개지지 않는다', () => {
        // 원본 personality 는 337행 전부 빈 문자열이라 virtueLabel(아도/명리/예교/
        // 할거/왕도/패도) 로 성향을 매핑한다. 전부 CALM 이면 AI 성향 다양성이 사라진다.
        const kinds = new Set(world.officers.map(o => o.personality));
        expect(kinds.size, `성향이 ${kinds.size}종뿐이다: ${[...kinds].join(',')}`)
            .toBeGreaterThanOrEqual(5);
    });

    it('성향이 원본 virtueLabel 분포와 대응한다', () => {
        const BY_VIRTUE: Record<string, string> = {
            '아도': 'AGGRESSIVE', '명리': 'CALM', '예교': 'LOYAL',
            '할거': 'GREEDY', '왕도': 'RIGHTEOUS', '패도': 'AMBITIOUS',
        };
        const bad: string[] = [];
        for (const o of world.officers) {
            const src = (officersFull.profiles as Record<string, { virtueLabel: string }>)[o.id];
            if (!src) continue;
            const expected = BY_VIRTUE[src.virtueLabel];
            if (expected && o.personality !== expected) {
                bad.push(`${o.name}(${src.virtueLabel}→${o.personality})`);
            }
        }
        expect(bad.slice(0, 8)).toEqual([]);
    });
});

describe('[08] 전장태세 — 다른 시나리오를 망가뜨리지 않는다', () => {
    it('기존 7개 시나리오가 그대로 있다', () => {
        const ids = ALL.map(s => s.id).sort();
        expect(ids).toEqual(['01', '02', '03', '04', '05', '06', '07', '08']);
    });

    it('08 은 다른 시나리오의 무장 ID 를 재사용하지 않는다 (각 시나리오 독립)', () => {
        const ids08 = new Set(world.officers.map(o => o.id));
        for (const other of ALL.filter(s => s.id !== '08')) {
            const w = buildWorld(other, 0);
            // 08 만 off_XXXX 형태의 대용량 로스터다. 기존 시나리오는 hi|id 스타일이다.
            const shared = w.officers.filter(o => ids08.has(o.id));
            expect(shared.length, `${other.id} 와 무장 ID 가 겹친다`).toBe(0);
        }
    });
});