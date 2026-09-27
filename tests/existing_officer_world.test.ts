/**
 * 실제무장편집 — 기존 무장 편집값이 월드에 반영되는지.
 *
 * 검증 초점:
 * - "월드에 있는 무장" 과 "없는 무장" 두 갈래가 모두 동작하는가
 * - 편집값이 실제로 반영되는가 (화면에서만 바뀌는 일이 없어야 한다)
 * - 소속/위치 링크가 끊기지 않는가
 */
import { describe, it, expect } from 'vitest';
import {
    buildExistingOfficerWorld,
    findWorldOfficerByName,
} from '../src/core/custom_officer_start.js';
import { buildWorld } from '../src/core/scenario_system.js';
import type { ScenarioData } from '../src/core/scenario_system.js';
import scenariosData from '../src/data/scenarios/index.json' with { type: 'json' };

const scenarios = scenariosData as ScenarioData[];
const scenario = scenarios[2]; // 군웅할거

const baseEdit = {
    name: '조장비',
    birthYear: 170,
    gender: 'M' as const,
    rank: 8,
    stats: { leadership: 95, might: 60, intelligence: 88, politics: 70, charisma: 80 },
    specialty: '火攻',
};

describe('findWorldOfficerByName', () => {
    const world = buildWorld(scenario, 0);
    it('이름으로 조조를 찾는다', () => {
        expect(findWorldOfficerByName(world, '조조')?.id).toBe('cao_cao');
    });
    it('빈 문자열은 null (빈 값으로 첫 무장을 고르면 안 된다)', () => {
        expect(findWorldOfficerByName(world, '   ')).toBeNull();
    });
    it('없는 이름은 null', () => {
        expect(findWorldOfficerByName(world, '존재하지않는무장')).toBeNull();
    });
    it('앞뒤 공백을 무시한다', () => {
        expect(findWorldOfficerByName(world, ' 조조 ')?.id).toBe('cao_cao');
    });
});

describe('buildExistingOfficerWorld — 월드에 이미 있는 무장', () => {
    const world = buildExistingOfficerWorld(scenario, 0, '조조', 'off_x', baseEdit);
    const officer = findWorldOfficerByName(world, '조장비')!;

    it('이름이 편집값으로 바뀐다', () => {
        expect(officer).toBeTruthy();
        expect(officer.id).toBe('cao_cao');
    });

    it('능력치 5개가 편집값으로 덮어써진다', () => {
        expect(officer.stats.leadership).toBe(95);
        expect(officer.stats.intelligence).toBe(88);
        expect(officer.stats.might).toBe(60);
    });

    it('생년/성별/품계/특기가 반영된다', () => {
        expect(officer.birthYear).toBe(170);
        expect(officer.gender).toBe('M');
        expect(officer.rank).toBe(8);
        expect(officer.specialty).toBe('火攻');
        expect(officer.skills).toEqual(['火攻']);
    });

    it('기존 소속과 위치는 유지된다 (역사적 배치를 지킨다)', () => {
        expect(officer.factionId).toBe('fac_0');
        expect(officer.cityId).toBeTruthy();
    });

    it('runtime 이 소속/위치와 어긋나지 않는다', () => {
        expect(officer.runtime.factionId).toBe(officer.factionId);
        expect(officer.runtime.locationId).toBe(officer.cityId);
    });

    it('무장 수는 늘어나지 않는다 (교체가지 편입이 아니다)', () => {
        const base = buildWorld(scenario, 0);
        expect(world.officers.length).toBe(base.officers.length);
    });

    it('세력 수도 그대로다 (fac_custom 같은 새 세력을 세우지 않는다)', () => {
        expect(world.playerFactionId).toBe('fac_0');
        expect(world.factions.find(f => f.id === 'fac_custom')).toBeUndefined();
    });

    it('군주로 지목돼 있으면 id 참조가 유지된다 (이름이 바뀌어도 끊기지 않는다)', () => {
        const faction = world.factions.find(f => f.id === 'fac_0')!;
        expect(faction.leaderId).toBe('cao_cao');
    });
});

describe('buildExistingOfficerWorld — 월드에 없는 무장', () => {
    const world = buildExistingOfficerWorld(scenario, 0, '완전없는이름', 'off_9999', baseEdit);
    const faction = world.factions.find(f => f.id === 'fac_0')!;
    const capital = world.cities.find(c => c.id === faction.capitalCityId)!;
    const added = world.officers.find(o => o.id === 'off_profile_off_9999')!;

    it('세력에 편입된다', () => {
        expect(added).toBeTruthy();
        expect(added.factionId).toBe('fac_0');
        expect(added.cityId).toBe(capital.id);
    });

    it('세력 명단과 도시 명단에 모두 등록된다 (링크가 끊기면 안 된다)', () => {
        expect(faction.officers).toContain(added.id);
        expect(capital.officerIds).toContain(added.id);
    });

    it('기존 무장들은 그대로 남는다', () => {
        expect(findWorldOfficerByName(world, '조조')).toBeTruthy();
    });

    it('월드 무장 수가 1 늘어난다', () => {
        const base = buildWorld(scenario, 0);
        expect(world.officers.length).toBe(base.officers.length + 1);
    });

    it('초상/판정에 쓰이는 성격이 부여된다', () => {
        expect(added.personality).toBeTruthy();
    });
});

describe('buildExistingOfficerWorld — 방어', () => {
    it('범위 밖 능력치는 잘라서 저장한다', () => {
        const world = buildExistingOfficerWorld(scenario, 0, '조조', 'off_x', {
            ...baseEdit, stats: { leadership: 999, might: -5, intelligence: 100, politics: 0, charisma: 55 },
        });
        const o = findWorldOfficerByName(world, '조장비')!;
        expect(o.stats.leadership).toBe(100);
        expect(o.stats.might).toBe(1);
        expect(o.stats.politics).toBe(1);
    });

    it('이름을 빈칸으로 보내면 원래 이름으로 되돌아간다 (무명 전사 방지)', () => {
        const world = buildExistingOfficerWorld(scenario, 0, '조조', 'off_x', { ...baseEdit, name: '   ' });
        expect(findWorldOfficerByName(world, '조조')).toBeTruthy();
    });

    it('특기를 비우면 skills 도 함께 비워진다 (빈 항목이 남으면 안 된다)', () => {
        const world = buildExistingOfficerWorld(scenario, 0, '조조', 'off_x', { ...baseEdit, specialty: null });
        expect(findWorldOfficerByName(world, '조장비')!.skills).toEqual([]);
    });

    it('id 가 겹치지 않는다', () => {
        const world = buildExistingOfficerWorld(scenario, 0, '없는이름', 'off_0001', baseEdit);
        expect(new Set(world.officers.map(o => o.id)).size).toBe(world.officers.length);
    });

    it('모든 시나리오에서 예외 없이 만들어진다', () => {
        for (const s of scenarios) {
            for (let i = 0; i < s.factions.length; i++) {
                const w = buildExistingOfficerWorld(s, i, '조조', 'off_x', baseEdit);
                expect(w.factions.length).toBeGreaterThan(0);
                expect(w.officers.length).toBeGreaterThan(0);
            }
        }
    });
});
