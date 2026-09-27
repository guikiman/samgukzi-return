/**
 * 신규 장수 생성 — 순수 로직 검증.
 * UI 배선(main.ts)은 브라우저 E2E가 본다. 여기는 결정성과 불변식만 확인한다.
 */
import { describe, it, expect } from 'vitest';
import {
    validateCustomOfficer,
    rollCustomStats,
    hashSeed,
    derivePersonality,
    buildCustomOfficerWorld,
} from '../src/core/custom_officer_start.js';
import type { ScenarioData } from '../src/core/scenario_system.js';
import scenariosData from '../src/data/scenarios/index.json' with { type: 'json' };

const scenarios = scenariosData as ScenarioData[];
const scenario = scenarios[2] ?? scenarios[0]; // 군웅할거 — 세력 5개

const baseInput = {
    name: '한중윤',
    courtesyName: '중윤',
    gender: 'M' as const,
    birthYear: 180,
    rank: 5,
    stats: { leadership: 70, might: 60, intelligence: 80, politics: 55, charisma: 65 },
    specialty: '火攻',
};

describe('validateCustomOfficer', () => {
    it('이름이 비면 막는다', () => {
        expect(validateCustomOfficer('', 180, 194)).toContain('성명');
    });

    it('이름이 8자를 넘으면 막는다', () => {
        expect(validateCustomOfficer('가나다라마바사아자차카', 180, 194)).toContain('8자');
    });

    it('앞뒤 공백은 정규화하지 않고 거부한다 (조용히 고치지 않기)', () => {
        expect(validateCustomOfficer(' 한중윤', 180, 194)).toContain('공백');
    });

    it('시작 시점 만 15세 미만은 막는다', () => {
        expect(validateCustomOfficer('한중윤', 190, 194)).toContain('15세');
    });

    it('유효한 입력은 빈 문자열을 반환한다', () => {
        // 194 - 178 = 16세. 연령 하한(15세)을 넘겨야 통과한다.
        expect(validateCustomOfficer('한중윤', 178, 194)).toBe('');
    });
});

describe('hashSeed / rollCustomStats', () => {
    it('같은 문자열은 같은 시드다 (재현 가능성)', () => {
        expect(hashSeed('한중윤|190')).toBe(hashSeed('한중윤|190'));
    });

    it('다른 문자열은 다른 시드다', () => {
        expect(hashSeed('한중윤')).not.toBe(hashSeed('한중'));
    });

    it('같은 시드는 능력치를 재현한다', () => {
        expect(rollCustomStats(hashSeed('abc'))).toEqual(rollCustomStats(hashSeed('abc')));
    });

    it('능력치는 항상 슬라이더 범위 1~100 안에 있다', () => {
        for (let i = 0; i < 500; i++) {
            for (const v of Object.values(rollCustomStats(i))) {
                expect(v).toBeGreaterThanOrEqual(1);
                expect(v).toBeLessThanOrEqual(100);
                expect(Number.isInteger(v)).toBe(true);
            }
        }
    });
});

describe('derivePersonality', () => {
    it('높은 품계 + 무력 우위면 공격형', () => {
        expect(derivePersonality({ leadership: 50, might: 80, intelligence: 40, politics: 50, charisma: 50 }, 8))
            .toBe('AGGRESSIVE');
    });

    it('높은 통솔이면 충성형', () => {
        expect(derivePersonality({ leadership: 85, might: 50, intelligence: 50, politics: 50, charisma: 50 }, 5))
            .toBe('LOYAL');
    });

    it('모든 값이 보통이면 침착형 (기본값 존재 보장)', () => {
        expect(derivePersonality({ leadership: 50, might: 50, intelligence: 50, politics: 50, charisma: 50 }, 5))
            .toBe('CALM');
    });
});


describe('buildCustomOfficerWorld', () => {
    const world = buildCustomOfficerWorld(scenario, baseInput);
    const faction = world.factions.find(f => f.id === world.playerFactionId)!;
    const city = world.cities.find(c => c.id === faction.capitalCityId)!;
    const officer = world.officers.find(o => o.id === faction.leaderId)!;

    it('플레이어 세력은 정확히 하나이고 플레이어 소유로 표시된다', () => {
        expect(world.factions.filter(f => f.isPlayerControlled)).toHaveLength(1);
        expect(faction.isPlayerControlled).toBe(true);
    });

    it('기존 세력은 AI가 된다 — playerFactionIndex=-1 이므로 소유자가 없다', () => {
        const others = world.factions.filter(f => f.id !== 'fac_custom');
        expect(others.length).toBeGreaterThan(0);
        expect(others.every(f => !f.isPlayerControlled)).toBe(true);
    });

    it('신규 장수 필드가 입력값을 그대로 반영한다', () => {
        expect(officer.name).toBe('한중윤');
        expect(officer.courtesyName).toBe('중윤');
        expect(officer.stats.intelligence).toBe(80);
        expect(officer.specialty).toBe('火攻');
        expect(officer.rank).toBe(5);
    });

    it('군주는 서기(LORD)이고 세력/도시에 소속되어 있다', () => {
        expect(officer.status).toBe('LORD');
        expect(officer.factionId).toBe('fac_custom');
        expect(officer.cityId).toBe(city.id);
    });

    it('장수의 도시/세력 참조가 서로 일치한다 (끊어진 링크 없음)', () => {
        expect(faction.officers).toContain(officer.id);
        expect(faction.cities).toContain(city.id);
        expect(city.ownerId).toBe('fac_custom');
        expect(city.officerIds).toContain(officer.id);
        expect(officer.runtime.factionId).toBe('fac_custom');
    });

    it('시작 연월은 시나리오를 따른다', () => {
        expect(world.startYear).toBe(194);
        expect(world.startMonth).toBe(1);
    });

    it('범위를 벗어난 능력치는 잘라서 저장한다 (1~100 보장)', () => {
        const wild = buildCustomOfficerWorld(scenario, {
            ...baseInput,
            stats: { leadership: 999, might: -50, intelligence: 100, politics: 0, charisma: 55 },
            rank: 99,
        });
        const o = wild.officers.find(x => x.id === 'off_custom_player')!;
        expect(o.stats.leadership).toBe(100);
        expect(o.stats.might).toBe(1);
        expect(o.stats.politics).toBe(1);
        expect(o.rank).toBe(9);
    });

    it('이름 앞뒤 공백은 저장 시 잘라낸다', () => {
        const w = buildCustomOfficerWorld(scenario, { ...baseInput, name: '  최강  ' });
        expect(w.officers.find(x => x.id === 'off_custom_player')!.name).toBe('최강');
    });

    it('특기가 비어 있으면 skills 배열에 빈 항목이 없다', () => {
        const w = buildCustomOfficerWorld(scenario, { ...baseInput, specialty: '' });
        const o = w.officers.find(x => x.id === 'off_custom_player')!;
        expect(o.skills).toEqual([]);
    });

    it('월드 전체의 id 가 겹치지 않는다', () => {
        expect(new Set(world.officers.map(o => o.id)).size).toBe(world.officers.length);
        expect(new Set(world.factions.map(f => f.id)).size).toBe(world.factions.length);
        expect(new Set(world.cities.map(c => c.id)).size).toBe(world.cities.length);
    });

    it('기존 시나리오 도시를 덮어쓰지 않는다', () => {
        expect(world.cities.filter(c => c.id === 'city_custom_hometown')).toHaveLength(1);
        expect(world.cities.length).toBeGreaterThan(2);
    });
});
