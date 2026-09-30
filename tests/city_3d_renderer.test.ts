import { describe, it, expect } from 'vitest';
import { City3DRenderer, dayNightPhase, generateDecorations, CITY_DAY_NIGHT_PERIOD_MS } from '../src/core/city_3d_renderer';
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

    it('should place overlay badges at clamped percentages', () => {
        // worldToScreen(2, 1, 42, 21) = (21, 31.5); origin (240, 148), buffer 480x240
        const pos = renderer.buildingBadgePercent(2, 1, 42, 21, 240, 148, 480, 240);
        expect(pos.left).toBeCloseTo((240 + 21) / 480 * 100, 6);
        expect(pos.top).toBeCloseTo((148 + 31.5) / 240 * 100, 6);
        // 화면 밖 건물은 4~96% 로 클램프된다
        const edge = renderer.buildingBadgePercent(100, -100, 42, 21, 240, 148, 480, 240);
        expect(edge.left).toBe(96);
        const bottom = renderer.buildingBadgePercent(100, 100, 42, 21, 240, 148, 480, 240);
        expect(bottom.top).toBe(96);
        const neg = renderer.buildingBadgePercent(-100, 100, 42, 21, 240, 148, 480, 240);
        expect(neg.left).toBe(4);
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

    it('computes day-night phases across one cycle', () => {
        const period = CITY_DAY_NIGHT_PERIOD_MS;
        expect(period).toBe(180000);
        const dawn = dayNightPhase(0, period);
        expect(dawn.t).toBe(0);
        expect(dawn.nightFactor).toBeGreaterThan(0.9);
        expect(dawn.phaseName).toBe('dawn');
        const noon = dayNightPhase(period / 2, period);
        expect(noon.nightFactor).toBeLessThan(0.1);
        expect(noon.phaseName).toBe('day');
        const dusk = dayNightPhase(period * 0.65, period);
        expect(dusk.phaseName).toBe('dusk');
        const night = dayNightPhase(period * 0.9, period);
        expect(night.nightFactor).toBeGreaterThan(0.9);
        expect(night.phaseName).toBe('night');
        for (const ms of [0, 1000, 45000, 90000, 135000, 179999]) {
            const p = dayNightPhase(ms, period);
            expect(p.nightFactor).toBeGreaterThanOrEqual(0);
            expect(p.nightFactor).toBeLessThanOrEqual(1);
        }
    });

    it('generates deterministic decorations per city', () => {
        const a = generateDecorations('city_허창', 3);
        const b = generateDecorations('city_허창', 3);
        expect(a).toEqual(b);
        expect(a.length).toBeGreaterThanOrEqual(8);
        expect(a.some(d => d.kind === 'pond')).toBe(true);
        const c = generateDecorations('city_건업', 3);
        expect(c).not.toEqual(a);
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
