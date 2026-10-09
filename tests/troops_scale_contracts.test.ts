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
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { describe, it, expect } from 'vitest';
import { GameStore } from '../src/core/game_store.js';
import { GameEngine } from '../src/core/game_engine.js';
import { DomesticCommand, CityRecruitmentCommand } from '../src/core/command_system.js';
import { buildWorld } from '../src/core/scenario_system.js';
import { ModSchemaValidator } from '../src/core/mod_schema_validator.js';
import { garrisonCap, computeRecruitGain } from '../src/core/faction_ai_monthly.js';
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

describe('병력 상한(garrisonCap) 규칙의 일관성', () => {
    // 병력을 늘리는 경로가 여럿이다(AI 자동 징병, AI 명령, 플레이어 UI,
    // BARRACKS 2곳). 상한을 제각각 두는 곳이 있으면 "도시마다 병력 규칙이
    // 다르다" 는 결함이 된다 — BARRACKS 가 두 번 그렇게 죽었다.
    // 여기서는 상한 규칙 자체를 계약으로 고정한다.

    it('상한은 인구의 12%, 수도는 15% — 최소 400', () => {
        expect(garrisonCap({ population: 50_000, isCapital: false })).toBe(6_000);
        expect(garrisonCap({ population: 50_000, isCapital: true })).toBe(7_500);
        // 하한: 아무리 작은 도시도 400명은 유지된다.
        expect(garrisonCap({ population: 500, isCapital: false })).toBe(400);
        expect(garrisonCap({ population: 0, isCapital: true })).toBe(400);
    });

    it('시나리오의 모든 도시 병력이 상한 이하로 시작한다', () => {
        const { store } = setupWorld();
        for (const c of store.getAllCities()) {
            const cap = garrisonCap(c);
            expect(c.development).toBeLessThanOrEqual(cap);
        }
    });

    it('병력이 상한에 닿으면 증가량은 0 이다', () => {
        // 상한이 없을 때 플레이어가 세력 AI 규칙을 우회해 병력을 무한정
        // 늘릴 수 있었다. 상한은 규칙이지 권고가 아니다.
        const r = computeRecruitGain(6_000, 50_000, false, 0.9);
        expect(r.capped).toBe(true);
        expect(r.gain).toBe(0);
        expect(r.cap).toBe(6_000);
    });

    it('상한이 남았으면 증가량은 상한을 넘지 않도록 잘라낸다', () => {
        // 병력 5,900 / 상한 6,000 → 빈자리 100명. 무작위 증가량(600~1000)을
        // 그대로 넣으면 상한을 깨고, 잘라내지 않으면 규칙이 허문이다.
        const r = computeRecruitGain(5_900, 50_000, false, 0.99);
        expect(r.capped).toBe(false);
        expect(r.gain).toBe(100);
        expect(5_900 + r.gain).toBe(r.cap);
    });

    it('빈자리가 충분하면 무작위 증가량(600~1000)이 그대로 적용된다', () => {
        // 증가량 규칙 자체는 밸런스 값이라 바꾸지 않는다 — 이 계약은
        // "바꾸지 않겠다" 를 고정해 이후 커밋에서 실수로 변하지 않게 한다.
        expect(computeRecruitGain(0, 1_000_000, true, 0).gain).toBe(600);
        expect(computeRecruitGain(0, 1_000_000, true, 0.999).gain).toBe(999);
    });

    it('roll 을 주입하면 결과가 결정론적이다 — Math.random 에 기대지 않는다', () => {
        // 무작위라서 실패하는 테스트를 만들지 않도록 roll 을 고정한다.
        const a = computeRecruitGain(1_000, 50_000, false, 0.5);
        const b = computeRecruitGain(1_000, 50_000, false, 0.5);
        expect(a).toEqual(b);
    });
});

// ────────────────────────────────────────────────────────────────────
// main.ts 는 브라우저 번들이므로 단위 테스트로 import 할 수 없다.
// (officer_ui_wiring.test.ts 와 같은 방식으로 소스를 정적으로 읽어 검증한다)
// 여기서 실제로 필요한 검사는 "증가량이 상한을 적용받아 계산되는가" 이다.
// 순수 함수만 테스트하고 호출부는 검사하지 않으면, main.ts 를 되돌려도
// 테스트가 통과한다 — 실제로 그렇게 확인했다. 이 블록이 그 빈틈을 막는다.
// ────────────────────────────────────────────────────────────────────
describe('main.ts 의 병력 증가 경로가 상한을 우회하지 않는다', () => {
    const MAIN_TS = readFileSync(
        resolvePath(__dirname, '..', 'src', 'main.ts'), 'utf8',
    );
    /** 주석 줄을 제거한 실제 코드만 검사한다 */
    const code = MAIN_TS
        .split('\n')
        .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');

    it('도시 UI 징병이 computeRecruitGain(상한 적용) 을 거친다', () => {
        // 핵심: 증가량을 상한 적용 함수에서 얻어와야 한다.
        // (적용 후 `development: city.development + gain` 으로 더하는 것 자체는
        //  올바르다 — gain 안에 상한이 이미 반영돼 있으므로. 무작위 증가량을
        //  직접 만드는 인라인 식이 남아 있는지만 보면 된다.)
        expect(code).toContain('computeRecruitGain(');
        // 무작위 증가량을 상한 없이 곧바로 만드는 인라인 식이 있으면 안 된다.
        expect(code).not.toMatch(/600 \+ Math\.floor\(Math\.random/);
    });

    it('BARRACKS 두 경로가 모두 garrisonCap 으로 상한을 건다', () => {
        // 예전엔 시설은 무제한, 건물은 1000 고정이었다. 두 곳 다 있어야 한다.
        const barracks = [...code.matchAll(/case (?:FacilityType\.BARRACKS|'BARRACKS'):([^\n]*)/g)]
            .map(m => m[1]);
        expect(barracks.length).toBe(2);
        for (const line of barracks) {
            expect(line).toContain('garrisonCap(');
        }
    });
});
