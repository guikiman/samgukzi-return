/**
 * 신규 장수 생성 — 타이틀 '신규 장수 생성'에서 호출되는 월드 빌더.
 *
 * 설계 결정:
 * - 기존 `buildWorld(scenario, idx)` 를 재사용한다. 도시를 손으로 만드는 건
 *   필드 하나 빠지면 크래시가 나고, 이미 검증된 경로가 이미 있다.
 * - 이 모듈은 그 결과물 위에 '플레이어 1인 + 수도 1개' 를 얹는다.
 *   나머지 세력은 AI가 그대로 구동되므로 저작 세력만 고립된다.
 * - 이 파일은 순수 함수다. 테스트에서 시드를 고정하면 재현 가능하다.
 */

import { OfficerBuilder } from './officer_factory.js';
import { buildWorld, CITY_MAX_DEFENSE } from './scenario_system.js';
import type { BuiltWorld, ScenarioData } from './scenario_system.js';
import type { City, Faction, Officer, OfficerStats } from './types.js';
import { OfficerStatus } from './types.js';

export interface CustomOfficerInput {
    name: string;
    courtesyName: string;
    gender: 'M' | 'F';
    birthYear: number;
    rank: number;
    stats: OfficerStats;
    specialty: string | null;
}

const clamp = (n: number, lo: number, hi: number, fallback: number): number =>
    (Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback);

/** 무작위 생성용 분포. 슬라이더와 같은 1~100 범위를 유지한다. */
export function rollCustomStats(seed: number): OfficerStats {
    let s = seed >>> 0;
    const next = (): number => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0x100000000;
    };
    // 세 번 뽑아 평균을 내면 중앙으로 몰리는 자연스러운 곡선이 된다.
    const bell = (): number => Math.max(1, Math.min(100, Math.round(20 + ((next() + next() + next()) / 3) * 70)));
    return {
        leadership: bell(),
        might: bell(),
        intelligence: bell(),
        politics: bell(),
        charisma: bell(),
    };
}

/** 입력 문자열을 32bit 시드로 변환. 같은 문자열이면 같은 장수가 나온다. */
export function hashSeed(text: string): number {
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
}

/** 입력 검증 — 이름만 필수. 나머지는 정규화되므로 여기서 막지 않는다. */
export function validateCustomOfficer(name: string, birthYear: number, startYear: number): string {
    const t = name.trim();
    if (t === '') return '성명을 입력하세요.';
    if (t.length > 8) return '성명은 8자 이내여야 합니다.';
    if (t !== name) return '성명 앞뒤에 공백을 넣을 수 없습니다.';
    if (!Number.isFinite(birthYear)) return '출생 연도를 확인하세요.';
    if (birthYear < 150 || birthYear > 210) return '출생 연도는 150~210 사이여야 합니다.';
    if (startYear - birthYear < 15) return '시작 시점에 만 15세 이하여야 합니다.';
    return '';
}

/** 능력치에서 성격을 유도 — 게임플레이 중엔 바뀌지 않는다. */
export function derivePersonality(stats: OfficerStats, rank: number): Officer['personality'] {
    if (rank >= 7 && stats.might >= stats.intelligence) return 'AGGRESSIVE';
    if (stats.charisma >= 70 && stats.politics >= 60) return 'RIGHTEOUS';
    if (stats.intelligence >= 75 && stats.politics >= stats.intelligence) return 'AMBITIOUS';
    if (stats.might <= 40 && stats.leadership <= 50) return 'TIMID';
    if (stats.leadership >= 70) return 'LOYAL';
    if (rank <= 3) return 'CAUTIOUS';
    return 'CALM';
}

/**
 * 플레이어 세력을 얹은 월드를 만든다.
 * scenario 는 '거울 무대' 로만 쓴다 — 다른 세력 배치를 재사용한다.
 */
export function buildCustomOfficerWorld(scenario: ScenarioData, input: CustomOfficerInput): BuiltWorld {
    // playerFactionIndex = -1 이면 어떤 세력도 플레이어 소유로 표시되지 않는다.
    const base = buildWorld(scenario, -1);

    const factionId = 'fac_custom';
    const cityId = 'city_custom_hometown';
    const officerId = 'off_custom_player';
    const birthYear = clamp(input.birthYear, 150, 210, 184);
    const stats: OfficerStats = {
        leadership: clamp(input.stats.leadership, 1, 100, 50),
        might: clamp(input.stats.might, 1, 100, 50),
        intelligence: clamp(input.stats.intelligence, 1, 100, 50),
        politics: clamp(input.stats.politics, 1, 100, 50),
        charisma: clamp(input.stats.charisma, 1, 100, 50),
    };
    const rank = clamp(input.rank, 0, 9, 5);

    const officer: Officer = OfficerBuilder.create(officerId, input.name.trim())
        .setCourtesyName(input.courtesyName.trim())
        .setGender(input.gender)
        .setBirthYear(birthYear)
        .setStats(stats)
        .setRank(rank)
        .setStatus(OfficerStatus.LORD)
        .setFactionId(factionId)
        .setCityId(cityId)
        .setLoyalty(100)
        .setAmbition(60)
        .setMorality(60)
        .setGreed(30)
        .setFame(100)
        .setMerit(0)
        .setSalary(50)
        .setSkills(input.specialty ? [input.specialty] : [])
        .setSpecialty(input.specialty)
        .build();

    officer.personality = derivePersonality(stats, rank);

    const city: City = {
        id: cityId,
        name: '고향',
        hexCoord: { q: 0, r: 0 },
        mapX: 0.5,
        mapY: 0.5,
        mapImageX: 0.5,
        mapImageY: 0.5,
        mapIconType: 'CAPITAL',
        population: 18000,
        defense: 30,
        maxDefense: CITY_MAX_DEFENSE,
        goldIncome: 60,
        foodIncome: 180,
        funds: 300,
        facilities: [],
        officerIds: [officerId],
        ownerId: factionId,
        isCapital: true,
        development: 30,
        developmentStats: {
            commerce: 30, maxCommerce: 100,
            farming: 35, maxFarming: 100,
            technology: 22, maxTechnology: 100,
            publicOrder: 66, maxPublicOrder: 100,
        },
        loyalty: 75,
        danger: 14,
        weather: 'SUNNY',
    };

    const faction: Faction = {
        id: factionId,
        name: `${input.name.trim()}의 세력`,
        leaderId: officerId,
        color: '#d4af6a',
        capitalCityId: cityId,
        cities: [cityId],
        officers: [officerId],
        armies: [],
        gold: 800,
        food: 3000,
        reputation: 30,
        policy: { recruitmentFocus: 3, militaryFocus: 3, economyFocus: 3, diplomacyFocus: 2, cultureFocus: 2 },
        diplomacy: {},
        isPlayerControlled: true,
        techLevel: 0,
    };

    return {
        officers: [...base.officers, officer],
        factions: [...base.factions, faction],
        cities: [...base.cities, city],
        playerFactionId: factionId,
        scenario: { id: scenario.id, difficulty: scenario.difficulty },
        startYear: base.startYear,
        startMonth: base.startMonth,
        // 신규 장수는 기존 인맥에 없다. 빈 배열이 정상이므로 그대로 둔다.
        relationships: base.relationships,
        // 요충지는 신규 무장과 무관하므로 기본 월드 값을 그대로 넘긴다.
        mapFeatures: base.mapFeatures,
    };
}

// ============================================================
// 실제무장편집 — 기존 무장을 고쳐서 출발 [신규 기능]
// ============================================================

/** 기존 무장 편집값. 편집 화면에서 고친 부분만 담는다. */
export interface ExistingOfficerEdit {
    name: string;
    birthYear: number;
    gender: 'M' | 'F';
    rank: number;
    stats: OfficerStats;
    specialty: string | null;
}

/**
 * 월드 안에서 이름으로 무장을 찾는다.
 *
 * 왜 이름으로 찾는가:
 * - 월드 무장 id 는 'cao_cao' 처럼 로마자 키이고 프로필 1200명의 id 는 'off_0123' 이다.
 *   두 id 공간이 겹치지 않으므로 id 로는 이어지지 않는다.
 * - 이름은 실제로 겹친다 (월드 68명 중 61명이 프로필 데이터셋에 존재).
 * - 그래도 못 찾는 경우를 반드시 처리한다 — 그때는 새로 편입한다.
 */
export function findWorldOfficerByName(world: BuiltWorld, name: string): Officer | null {
    const target = name.trim();
    if (target === '') return null;
    return world.officers.find(o => o.name === target) ?? null;
}

/**
 * 기존 무장을 편집값으로 출발하는 월드를 만든다.
 *
 * 두 갈래로 갈린다:
 * - 월드에 이미 있는 무장이면 → 그 무장을 고쳐서 쓴다 (역사적 위치 유지)
 * - 없으면 → 고른 세력에 새로 편입한다
 *
 * 어느 쪽이든 플레이어는 '고른 세력'을 조종한다. 새 세력을 세우지 않는다.
 * 실제무장편집의 의미가 그것이기 때문이다.
 */
export function buildExistingOfficerWorld(
    scenario: ScenarioData,
    factionIndex: number,
    profileName: string,
    profileId: string,
    edit: ExistingOfficerEdit,
): BuiltWorld {
    const world = buildWorld(scenario, factionIndex);
    const faction = world.factions.find(f => f.id === world.playerFactionId);
    if (!faction) return world; // 방어적: 세력이 없으면 원본 그대로
    const capital = world.cities.find(c => c.id === faction.capitalCityId) ?? world.cities[0];

    const stats: OfficerStats = {
        leadership: clamp(edit.stats.leadership, 1, 100, 50),
        might: clamp(edit.stats.might, 1, 100, 50),
        intelligence: clamp(edit.stats.intelligence, 1, 100, 50),
        politics: clamp(edit.stats.politics, 1, 100, 50),
        charisma: clamp(edit.stats.charisma, 1, 100, 50),
    };
    const name = edit.name.trim() || profileName;
    const birthYear = clamp(edit.birthYear, 110, 230, 184);
    const rank = clamp(edit.rank, 0, 9, 5);

    const target = findWorldOfficerByName(world, profileName);
    if (target) {
        // 이미 있는 무장: 값을 덮어쓴다. 소속/위치는 그대로 둔다.
        target.name = name;
        target.birthYear = birthYear;
        target.gender = edit.gender;
        target.rank = rank;
        target.stats = { ...target.stats, ...stats };
        target.specialty = edit.specialty;
        target.skills = edit.specialty ? [edit.specialty] : [];
        target.personality = derivePersonality(stats, rank);
        // runtime 은 소속/위치를 따로 들고 있다. 갱신하지 않으면 어긋난다.
        target.runtime.factionId = target.factionId;
        if (target.cityId) target.runtime.locationId = target.cityId;
        return world;
    }

    // 월드에 없는 무장: 고른 세력에 편입한다.
    const officerId = `off_profile_${profileId}`;
    const officer: Officer = OfficerBuilder.create(officerId, name)
        .setCourtesyName('')
        .setGender(edit.gender)
        .setBirthYear(birthYear)
        .setStats(stats)
        .setRank(rank)
        .setStatus(OfficerStatus.OFFICER)
        .setFactionId(faction.id)
        .setCityId(capital?.id ?? null)
        .setLoyalty(90)
        .setSpecialty(edit.specialty)
        .setSkills(edit.specialty ? [edit.specialty] : [])
        .build();
    officer.personality = derivePersonality(stats, rank);

    world.officers.push(officer);
    faction.officers.push(officerId);
    if (capital) capital.officerIds.push(officerId);
    return world;
}
