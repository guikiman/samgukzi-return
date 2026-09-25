import { describe, expect, it } from 'vitest';
import {
    calculateOfficerDecision,
    runAITurn,
    type CitySnapshot,
    type FactionSnapshot,
    type OfficerSnapshot,
} from '../src/ai/ai_worker_simulator.js';

const baseStats = {
    leadership: 70,
    might: 70,
    intelligence: 70,
    politics: 70,
    charisma: 70,
};

function officer(overrides: Partial<OfficerSnapshot> = {}): OfficerSnapshot {
    return {
        id: 'officer-1',
        name: 'Test Officer',
        factionId: 'faction-1',
        cityId: 'city-1',
        ambition: 60,
        loyalty: 80,
        morality: 50,
        infamy: 0,
        stats: baseStats,
        isPlayer: false,
        ...overrides,
    };
}

function city(overrides: Partial<CitySnapshot> = {}): CitySnapshot {
    return {
        id: 'city-1',
        name: 'Test City',
        ownerId: 'faction-1',
        defense: 50,
        population: 10_000,
        funds: 500,
        foodStores: 1_000,
        development: 70,
        maxTroops: 100,
        ...overrides,
    };
}

function faction(overrides: Partial<FactionSnapshot> = {}): FactionSnapshot {
    return {
        id: 'faction-1',
        name: 'Test Faction',
        leaderId: 'officer-1',
        temperament: 'KINGLY',
        gold: 1_000,
        food: 1_000,
        cityCount: 1,
        atWarWith: [],
        alliedWith: [],
        ...overrides,
    };
}

describe('calculateOfficerDecision', () => {
    it('excludes the player officer', () => {
        expect(calculateOfficerDecision(
            officer({ isPlayer: true }),
            { 'city-1': city() },
            { 'faction-1': faction() },
        )).toBeNull();
    });

    it('prioritizes a loyalty crisis over other actions', () => {
        const decision = calculateOfficerDecision(
            officer({ loyalty: 20, ambition: 80 }),
            { 'city-1': city() },
            { 'faction-1': faction() },
        );

        expect(decision?.actionType).toBe('REST');
        expect(decision?.reasoning).toContain('충성도');
    });

    it('prioritizes food relief when the home city and faction are short on food', () => {
        const decision = calculateOfficerDecision(
            officer(),
            { 'city-1': city({ foodStores: 100 }) },
            { 'faction-1': faction({ food: 100 }) },
        );

        expect(decision?.actionType).toBe('DOMESTIC');
        expect(decision?.payload.targetCityId).toBe('city-1');
    });

    it('returns a concrete diplomacy target for alliance reinforcement', () => {
        const decision = calculateOfficerDecision(
            officer({ stats: { ...baseStats, politics: 90 } }),
            { 'city-1': city({ development: 100, defense: 100, funds: 1_000, foodStores: 1_000 }) },
            { 'faction-1': faction({ alliedWith: ['faction-2'] }) },
        );

        expect(decision?.actionType).toBe('DIPLOMACY');
        expect(decision?.payload).toMatchObject({ targetFactionId: 'faction-2', action: 'GIFT' });
    });

    it('attacks the weakest enemy city when aggression and supplies allow it', () => {
        const decision = calculateOfficerDecision(
            officer(),
            {
                'city-1': city(),
                'enemy-city': city({
                    id: 'enemy-city',
                    name: 'Weak Enemy City',
                    ownerId: 'faction-2',
                    defense: 10,
                }),
            },
            { 'faction-1': faction({ atWarWith: ['faction-2'] }) },
        );

        expect(decision?.actionType).toBe('BATTLE');
        expect(decision?.payload.targetCityId).toBe('enemy-city');
    });
});

describe('runAITurn', () => {
    it('groups non-player decisions by faction and free officers', async () => {
        const result = await runAITurn({
            year: 220,
            month: 1,
            turn: 1,
            factions: {
                'faction-1': faction(),
                'faction-2': faction({
                    id: 'faction-2',
                    name: 'Second Faction',
                    leaderId: 'officer-2',
                }),
            },
            officers: [
                officer(),
                officer({ id: 'officer-2', factionId: 'faction-2', cityId: 'city-2' }),
                officer({ id: 'officer-3', factionId: null, cityId: null }),
                officer({ id: 'player-1', isPlayer: true }),
            ],
            cities: {
                'city-1': city(),
                'city-2': city({ id: 'city-2', ownerId: 'faction-2' }),
            },
        }, () => undefined, 0);

        expect(result.totalDecisions).toBe(3);
    });
});
