import { describe, it, expect } from 'vitest';
import { City3DRenderer } from '../src/core/city_3d_renderer';
import { buildWorld } from '../src/core/scenario_system.js';
import scenarioIndex from '../src/data/scenarios/index.json';

describe('City3DRenderer', () => {
    const renderer = new City3DRenderer();

    it('should generate city layout', () => {
        const buildings = renderer.generateCityLayout('city_1', 5, 'SPRING');
        expect(buildings.length).toBeGreaterThan(0);
        expect(new Set(buildings.map(b => b.id)).size).toBe(buildings.length);
        expect(buildings.every(b => b.active && b.investment === 0)).toBe(true);
    });

    it('restores saved building level, investment and operating state', () => {
        const id = 'city_1:0';
        const buildings = renderer.generateCityLayout('city_1', 5, 'SPRING', {
            [id]: { level: 4, investment: 360, active: false },
        });
        expect(buildings[0]).toMatchObject({ id, level: 4, investment: 360, active: false });
    });

    it('should generate more buildings with higher development', () => {
        const low = renderer.generateCityLayout('city_1', 1, 'SPRING');
        const high = renderer.generateCityLayout('city_1', 10, 'SPRING');
        expect(high.length).toBeGreaterThanOrEqual(low.length);
    });

    it('should return building colors', () => {
        const colors = renderer.getBuildingColor('GOVERNMENT', 3, 'SPRING');
        expect(colors.wall).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(colors.roof).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('should adjust brightness based on level', () => {
        const low = renderer.getBuildingColor('HOUSE', 1, 'SPRING');
        const high = renderer.getBuildingColor('HOUSE', 5, 'SPRING');
        expect(low.wall).not.toBe(high.wall);
    });

    it('should return different roof colors for different building types', () => {
        const gov = renderer.getBuildingColor('GOVERNMENT', 3, 'SPRING');
        const farm = renderer.getBuildingColor('FARM', 3, 'SPRING');
        expect(gov.roof).not.toBe(farm.roof);
    });

    it('should convert world to screen coordinates', () => {
        const screen = renderer.worldToScreen(0, 0, 64, 32);
        expect(screen.sx).toBe(0);
        expect(screen.sy).toBe(0);
    });

    it('should convert positive coordinates correctly', () => {
        const screen = renderer.worldToScreen(2, 1, 64, 32);
        expect(screen.sx).toBe(32);  // (2-1)*64/2
        expect(screen.sy).toBe(48);  // (2+1)*32/2
    });

    it('should have buildings with labels', () => {
        const buildings = renderer.generateCityLayout('city_1', 5, 'SUMMER');
        expect(buildings.every(b => b.label.length > 0)).toBe(true);
    });

    it('should render different seasons with different colors', () => {
        const spring = renderer.generateCityLayout('city_1', 5, 'SPRING');
        const winter = renderer.generateCityLayout('city_1', 5, 'WINTER');
        expect(spring[0].color).not.toBe(winter[0].color);
    });

    it('generates a valid building layout for every scenario city', () => {
        for (const scenario of scenarioIndex as Array<{ id: string; factions: unknown[] }>) {
            const world = buildWorld(scenario as never, 0);
            for (const city of world.cities) {
                const buildings = renderer.generateCityLayout(city.id, Math.max(1, city.development / 20), 'SPRING');
                expect(buildings.length).toBeGreaterThanOrEqual(5);
                expect(new Set(buildings.map(b => b.id)).size).toBe(buildings.length);
                expect(buildings.every(b => b.level >= 1 && b.level <= 5)).toBe(true);
            }
        }
    });
});
