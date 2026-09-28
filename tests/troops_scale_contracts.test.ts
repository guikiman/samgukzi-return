/**
 * City.development = "병력 수(명)" 계약 테스트
 *
 * 5c83dab 에서 City.development 이 0~100 "개발도" 가 아니라 병력(명) 이라는
 * 사실을 확정하고 시뮬레이션 쪽 소비자를 고쳤다. 그때 stash 에만 남아 있고
 * 커밋되지 않았던 결함들, 그리고 stash 에조차 없던 결함 두 건을 여기서 고정한다.
 *
 * 배경 — 왜 이런 결함이 계속 살아남았는가:
 *   1) 병력이 0~100 이면 전 도시가 "병력 700" 처럼 평준화돼 열세 판정이
 *      구조적으로 성립하지 않는다. 그런데 테스트는 "일어난다" 를 검사할 뿐
 *      "값이 말이 되는 규모인가" 는 검사하지 않았다.
 *   2) 오프셋이 두 곳에 나뉘어 있으면 서로 상쇄돼 테스트가 통과한다.
 *      #8 은 정확히 그랬다(호출부 ×100, 렌더러 ÷100).
 *
 * 이 파일은 "값의 규모" 를 계약으로 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { formatGarrisonText } from '../src/core/china_map_renderer.js';
import { GameStore } from '../src/core/game_store.js';
import { GameEngine } from '../src/core/game_engine.js';
import { DomesticCommand, CityRecruitmentCommand } from '../src/core/command_system.js';
import { buildWorld } from '../src/core/scenario_system.js';
import { ModSchemaValidator } from '../src/core/mod_schema_validator.js';
import { AIStreamManager } from '../src/ai/ai_stream_manager.js';
import scenarioIndex from '../src/data/scenarios/index.json';
import type { CityID, OfficerID } from '../src/core/types.js';

function setupWorld(): { store: GameStore; engine: GameEngine } {
    const store = new GameStore();
    const engine = new GameEngine(store);
    const scenario = (scenarioIndex as Array<{ id: string }>).find(s => s.id === '05')!;
    const world = buildWorld(scenario as never, 0);
    engine.initWorld(world.officers, world.factions, world.cities, []);
    store.setGlobalState({ playerFactionId: 'fac_0' });
    return { store, engine };
}

/** fac_1 무장과 그 무장이 있는 도시를 하나 고른다 (AI 세력 = 플레이어 아님). */
function pickOfficerAndCity(store: GameStore) {
    const officer = store.getAllOfficers().find(o => o.factionId === 'fac_1' && o.cityId)!;
    const city = store.getCity(officer.cityId!)!;
    store.updateOfficer(officer.id, { actionPoints: 100 });
    return { officer, city };
}

describe('결함 #8 — 지도 병력 배지가 100배 부풀어 표시된다', () => {
    it('formatGarrisonText 는 병력 수(명)을 만 단위로 정확히 환산한다', () => {
        // 회귀 증명이 목적이므로 옛 값(832.5만)을 명시해 적어둔다.
        expect(formatGarrisonText(8_325)).toBe('8,325명');   // 옛엔 "832.5만"
        expect(formatGarrisonText(83_000)).toBe('8.3만');
        expect(formatGarrisonText(4_096)).toBe('4,096명');
        expect(formatGarrisonText(10_000)).toBe('1만');
        expect(formatGarrisonText(0)).toBe('0명');
    });

    it('병력이 0 미만이나 NaN 이어도 안전한 문자열을 준다', () => {
        expect(formatGarrisonText(-500)).toBe('0명');
        expect(formatGarrisonText(NaN)).toBe('0명');
    });

    it('시나리오 도시 병력은 인구 비례 규모다 — 0~100 이 아니다', () => {
        // 0~100 이면 전 도시가 700 근처로 평준화돼 도시 간 격차가 사라진다.
        const { store } = setupWorld();
        const cities = store.getAllCities();
        expect(cities.length).toBeGreaterThan(0);
        for (const c of cities) {
            expect(c.development).toBeGreaterThanOrEqual(400);
            const ratio = c.development / c.population;
            expect(ratio).toBeGreaterThan(0.02);
            expect(ratio).toBeLessThan(0.20);
        }
        // 도시마다 값이 실제로 다르다 — 전부 같으면 규모가 아니라 상수다.
        expect(new Set(cities.map(c => c.development)).size).toBeGreaterThan(1);
    });

    it('지도 배지 문자열은 어느 도시도 100배 부풀어 표기하지 않는다', () => {
        const { store } = setupWorld();
        for (const c of store.getAllCities()) {
            const text = formatGarrisonText(c.development);
            if (text.endsWith('만')) {
                const man = Number(text.slice(0, -1));
                expect(man * 10_000).toBeGreaterThan(c.development * 0.95);
                expect(man * 10_000).toBeLessThanOrEqual(c.development * 1.05 + 5_000);
            } else {
                expect(Number(text.replace(/[^0-9]/g, ''))).toBe(c.development);
            }
        }
    });
});

describe('결함 #9 — 내정이 병력(development)을 올린다', () => {
    it('내정 커맨드는 병력을 건드리지 않고 개발 지표를 올린다', () => {
        const { store, engine } = setupWorld();
        const { officer, city } = pickOfficerAndCity(store);
        const beforeTroops = city.development;
        const beforeFarming = city.developmentStats.farming;

        engine.enqueueCommand(new DomesticCommand(officer.id as OfficerID, city.id as CityID, 'FARM', 0));
        expect(engine.executeAllCommands()[0]?.success).toBe(true);

        const after = store.getCity(city.id)!;
        // [핵심 계약] 내정 = 개발 지표 상승. 병력은 절대 늘지 않는다.
        expect(after.development).toBe(beforeTroops);
        expect(after.developmentStats.farming).toBeGreaterThan(beforeFarming);
    });

    it('내정 시 병력 증가는 0 이다 — 규모 불일치가 아니라 규칙이다', () => {
        // 이 계약이 깨지면 "내정 → 병력 증가" 로 되돌아가는 걸 잡는다.
        // 병력 증가는 도시 징병 커맨드만 담당한다.
        const { store, engine } = setupWorld();
        const { officer, city } = pickOfficerAndCity(store);
        for (const facility of ['FARM', 'MARKET', 'BLACKSMITH', 'TAVERN'] as const) {
            const troopsBefore = store.getCity(city.id)!.development;
            engine.enqueueCommand(new DomesticCommand(officer.id as OfficerID, city.id as CityID, facility, 0));
            engine.executeAllCommands();
            expect(store.getCity(city.id)!.development).toBe(troopsBefore);
        }
    });

    it('도시 징병 커맨드는 병력을 실제로 늘린다 — 두 커맨드의 역할이 나뉜다', () => {
        const { store, engine } = setupWorld();
        const { officer, city } = pickOfficerAndCity(store);
        const before = store.getCity(city.id)!.development;
        engine.enqueueCommand(new CityRecruitmentCommand(officer.id as OfficerID, city.id as CityID, 0));
        expect(engine.executeAllCommands()[0]?.success).toBe(true);
        // 병력을 늘리는 경로가 하나라도 사라지면 안 된다.
        expect(store.getCity(city.id)!.development).toBeGreaterThan(before);
    });

    it('내정 후 undo 하면 개발 지표·경험치가 원래대로 돌아온다', () => {
        const { store, engine } = setupWorld();
        const { officer, city } = pickOfficerAndCity(store);
        const beforeStats = { ...store.getCity(city.id)!.developmentStats };
        const beforeExp = store.getOfficer(officer.id)!.exp.politics;

        engine.enqueueCommand(new DomesticCommand(officer.id as OfficerID, city.id as CityID, 'FARM', 0));
        engine.executeAllCommands();
        expect(store.getCity(city.id)!.developmentStats.farming).toBeGreaterThan(beforeStats.farming);

        expect(engine.undoLastCommand()).toBe(true);
        // SideEffect 는 "exp.politics" 라는 점 경로로 기록된다.
        // 점 경로를 평평하게 펼치면 쓰러진 속성만 남고 undo 가 조용히 실패한다.
        expect(store.getCity(city.id)!.developmentStats).toEqual(beforeStats);
        expect(store.getOfficer(officer.id)!.exp.politics).toBe(beforeExp);
        expect(Object.keys(store.getOfficer(officer.id)! as unknown as Record<string, unknown>))
            .not.toContain('exp.politics');
    });
});

describe('development 0~100 가정이 남아있는 소비처', () => {
    it('모드 스키마 검증기가 병력 규모를 위조로 판정하지 않는다', () => {
        const validator = new ModSchemaValidator();
        // 병력이 8,325명인 도시 프로필은 정당한 데이터다.
        const result = validator.validateCity({ id: 'city_001', name: '낙양', development: 8_325, commerce: 60, defense: 50 });
        expect(result.valid).toBe(true);
        // 음수는 여전히 위조다.
        expect(validator.validateCity({ id: 'c', name: 'x', development: -1 }).valid).toBe(false);
    });

    it('스트리밍 AI 스냅샷이 병력을 100 으로 잘라내지 않는다', () => {
        const { store } = setupWorld();
        const payload = AIStreamManager.buildSnapshot(store, 'fac_0');
        for (const city of store.getAllCities()) {
            const snap = payload.cities[city.id];
            expect(snap).toBeDefined();
            // 0~100 으로 잘리면 수천~수만 병력이 전부 100 이 되어 도시 간
            // 격차가 사라지고, 워커는 "전 도시가 약하다" 고 판단한다.
            expect(snap!.development).toBe(city.development);
            expect(snap!.development).toBeGreaterThan(100);
        }
    });
});
