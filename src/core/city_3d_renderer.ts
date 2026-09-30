/**
 * [D32] 3D 도시 전경 렌더링 — City 3D Renderer
 *
 * City3DRenderer:
 *   - 등각투영(Isometric) 뷰
 *   - 건물 레벨 1~5 (크기/지붕장식/색상 변화)
 *   - 계절별 건물 색상
 *   - screenX = (x - y) * tileWidth/2, screenY = (x + y) * tileHeight/2
 */

import type { Season, CityID } from './types';

export type CityBuildingType =
    | 'GOVERNMENT' | 'BARRACKS' | 'MARKET' | 'FARM'
    | 'TEMPLE' | 'WORKSHOP' | 'WALL' | 'HOUSE';

export interface CityBuilding {
    /** 도시 내 배치 슬롯 ID — 도시 화면과 저장 상태의 연결 키 */
    readonly id: string;
    readonly type: CityBuildingType;
    readonly level: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly color: string;
    readonly roofColor: string;
    readonly label: string;
    readonly investment: number;
    readonly active: boolean;
}

const BUILDING_DEFS: Record<CityBuildingType, { label: string; baseWidth: number; baseHeight: number }> = {
    GOVERNMENT: { label: '관청', baseWidth: 60, baseHeight: 50 },
    BARRACKS: { label: '병영', baseWidth: 50, baseHeight: 40 },
    MARKET: { label: '시장', baseWidth: 40, baseHeight: 35 },
    FARM: { label: '농지', baseWidth: 50, baseHeight: 30 },
    TEMPLE: { label: '사원', baseWidth: 35, baseHeight: 45 },
    WORKSHOP: { label: '공방', baseWidth: 40, baseHeight: 35 },
    WALL: { label: '성벽', baseWidth: 80, baseHeight: 15 },
    HOUSE: { label: '주택', baseWidth: 30, baseHeight: 25 },
};

/**
 * 선언된 건물 타입 전수 목록.
 * 배경 그림의 라벨 앵커처럼 "타입마다 하나씩 있어야 하는" 표를 검증할 때 쓴다 —
 * 타입이 늘어도 앵커를 빠뜨리지 않게 하기 위한 기준 목록이다.
 */
export const CITY_BUILDING_TYPES = Object.keys(BUILDING_DEFS) as CityBuildingType[];

const SEASON_COLORS: Record<Season, Record<string, string>> = {
    SPRING: { roof: '#8BAA6E', wall: '#D4C5A9', ground: '#7CB342' },
    SUMMER: { roof: '#5B8C4E', wall: '#C4B599', ground: '#558B2F' },
    AUTUMN: { roof: '#B8864E', wall: '#BFA580', ground: '#8D6E3F' },
    WINTER: { roof: '#E8E8F0', wall: '#D4D0C8', ground: '#BDBDBD' },
};

export const CITY_DAY_NIGHT_PERIOD_MS = 180000;

export interface DayNightPhase {
    readonly t: number;
    readonly nightFactor: number;
    readonly phaseName: 'dawn' | 'day' | 'dusk' | 'night';
}

function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

/** 주야 위상 — 새벽 0 → 정오 0.5 → 새벽 1, 1주기는 기본 3분 */
export function dayNightPhase(nowMs: number, periodMs: number = CITY_DAY_NIGHT_PERIOD_MS): DayNightPhase {
    const t = ((nowMs % periodMs) + periodMs) % periodMs / periodMs;
    const daylight = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
    const nightFactor = 1 - smoothstep(0.25, 0.6, daylight);
    const phaseName = t < 0.2 ? 'dawn' : t < 0.55 ? 'day' : t < 0.75 ? 'dusk' : 'night';
    return { t, nightFactor, phaseName };
}

export interface CityDecor {
    readonly kind: 'blossom' | 'pine' | 'lantern' | 'pond' | 'rock';
    readonly x: number;
    readonly y: number;
    readonly size: number;
}

function hashCitySeed(cityId: string): () => number {
    let state = 0x811C9DC5;
    for (let i = 0; i < cityId.length; i++) {
        state ^= cityId.charCodeAt(i);
        state = Math.imul(state, 0x01000193);
    }
    return () => {
        state = (Math.imul(state ^ (state >>> 15), 0x2C1B3C6D)) >>> 0;
        state = (Math.imul(state ^ (state >>> 12), 0x297A2D39)) >>> 0;
        state ^= state >>> 15;
        return (state >>> 0) / 0xFFFFFFFF;
    };
}

/** 도시 장식 배치 — 도시 ID로 결정돼 다시 열어도 같다. */
export function generateDecorations(cityId: string, gridRadius: number): CityDecor[] {
    const rand = hashCitySeed(cityId);
    const decors: CityDecor[] = [
        { kind: 'pond', x: -gridRadius - 1.6, y: gridRadius * 0.6, size: 1 },
        { kind: 'rock', x: gridRadius + 1.8, y: gridRadius * 0.4, size: 1 },
    ];
    const count = 6 + Math.floor(rand() * 3);
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + rand() * 0.5;
        const radius = gridRadius + 1.2 + rand() * 1.2;
        const roll = rand();
        const kind = roll < 0.4 ? 'blossom' : roll < 0.7 ? 'pine' : roll < 0.9 ? 'lantern' : 'rock';
        decors.push({
            kind,
            x: Math.cos(angle) * radius,
            y: gridRadius + Math.sin(angle) * radius * 0.6,
            size: 0.7 + rand() * 0.6,
        });
    }
    return decors;
}

export class City3DRenderer {
    /** 도시 건물 배치 생성 */
    generateCityLayout(
        cityId: CityID,
        developmentLevel: number,
        season: Season,
        savedStates: Record<string, { level: number; investment: number; active: boolean }> = {},
    ): CityBuilding[] {
        const buildings: CityBuilding[] = [];
        const colors = SEASON_COLORS[season];
        const buildingCount = Math.max(5, Math.floor(developmentLevel * 2));

        // 건물 타입 가중치
        const typePool: CityBuildingType[] = [];
        for (const t of ['GOVERNMENT', 'BARRACKS', 'MARKET', 'FARM', 'TEMPLE', 'WORKSHOP', 'WALL', 'HOUSE', 'HOUSE', 'HOUSE', 'HOUSE'] as CityBuildingType[]) {
            typePool.push(t);
        }

        // 타일 배치 (등각투영 그리드)
        const gridSize = Math.ceil(Math.sqrt(buildingCount));
        for (let i = 0; i < buildingCount; i++) {
            const gx = i % gridSize;
            const gy = Math.floor(i / gridSize);
            const type = typePool[i % typePool.length];
            const buildingId = `${cityId}:${i}`;
            const saved = savedStates[buildingId];
            const level = Math.min(5, Math.max(1, saved?.level ?? Math.floor(developmentLevel / 2) + (i % 3)));

            const def = BUILDING_DEFS[type];
            const sizeMultiplier = 1 + (level - 1) * 0.15;

            buildings.push({
                id: buildingId,
                type,
                level,
                x: gx - gy,
                y: gx + gy,
                width: Math.floor(def.baseWidth * sizeMultiplier),
                height: Math.floor(def.baseHeight * sizeMultiplier),
                color: this.getBuildingColor(type, level, season).wall,
                roofColor: this.getBuildingColor(type, level, season).roof,
                label: def.label,
                investment: saved?.investment ?? 0,
                active: saved?.active ?? true,
            });
        }

        return buildings;
    }

    /** 건물 색상 (계절/레벨 기반) */
    getBuildingColor(buildingType: CityBuildingType, level: number, season: Season): { wall: string; roof: string } {
        const colors = SEASON_COLORS[season];
        const levelBrightness = 0.7 + level * 0.06;

        const wallColor = this.adjustBrightness(colors.wall, levelBrightness);
        let roofColor: string;

        switch (buildingType) {
            case 'GOVERNMENT': roofColor = this.adjustBrightness('#8B0000', levelBrightness); break;
            case 'BARRACKS': roofColor = this.adjustBrightness('#4A4A4A', levelBrightness); break;
            case 'TEMPLE': roofColor = this.adjustBrightness('#DAA520', levelBrightness); break;
            case 'MARKET': roofColor = this.adjustBrightness('#CD853F', levelBrightness); break;
            case 'WALL': roofColor = this.adjustBrightness('#8B8378', levelBrightness); break;
            default: roofColor = colors.roof;
        }

        return { wall: wallColor, roof: roofColor };
    }

    /** 밝기 조정 */
    private adjustBrightness(hex: string, factor: number): string {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const nr = Math.min(255, Math.floor(r * factor));
        const ng = Math.min(255, Math.floor(g * factor));
        const nb = Math.min(255, Math.floor(b * factor));
        return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
    }

    /** 등각투영 좌표 변환 */
    worldToScreen(x: number, y: number, tileWidth: number = 64, tileHeight: number = 32): { sx: number; sy: number } {
        return {
            sx: (x - y) * tileWidth / 2,
            sy: (x + y) * tileHeight / 2,
        };
    }

    /**
     * 건물 오버레이 배지 위치 — 캔버스 버퍼 좌표를 표시 영역 % 로 바꾼다.
     * main.ts 씬(originX/originY 오프셋 포함)과 같은 변환을 쓴다.
     */
    buildingBadgePercent(
        x: number, y: number, tileWidth: number, tileHeight: number,
        originX: number, originY: number, width: number, height: number,
    ): { left: number; top: number } {
        const point = this.worldToScreen(x, y, tileWidth, tileHeight);
        const clamp = (v: number): number => Math.max(4, Math.min(96, v));
        return {
            left: clamp((originX + point.sx) / width * 100),
            top: clamp((originY + point.sy) / height * 100),
        };
    }

    /** 빌딩 렌더링 (복셀 풍 캔버스 2D) — nightFactor 0(낮)~1(밤)에 따라 창문·등불이 점등된다. */
    renderBuilding(ctx: CanvasRenderingContext2D, building: CityBuilding, tileWidth: number, tileHeight: number, nightFactor = 0): void {
        const { sx, sy } = this.worldToScreen(building.x, building.y, tileWidth, tileHeight);
        const w = building.width;
        const h = building.height;
        const night = Math.max(0, Math.min(1, nightFactor));

        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.ellipse(sx, sy + 2, w * 0.55, h * 0.12, 0, 0, Math.PI * 2);
        ctx.fill();

        switch (building.type) {
            case 'GOVERNMENT':
                this.drawPagoda(ctx, sx, sy, w, h, building, night, 2);
                break;
            case 'TEMPLE':
                this.drawPagoda(ctx, sx, sy, w, h, building, night, 2, true);
                break;
            case 'FARM':
                this.drawField(ctx, sx, sy, w, h, building, night);
                break;
            case 'WALL':
                this.drawWall(ctx, sx, sy, w, h, building);
                break;
            default:
                this.drawHouse(ctx, sx, sy, w, h, building, night);
                break;
        }

        this.drawTypeProp(ctx, sx, sy, w, h, building, night);

        // 레벨 표시 (별)
        if (building.level >= 4) {
            ctx.fillStyle = '#FFD700';
            ctx.font = '10px serif';
            ctx.textAlign = 'center';
            ctx.fillText('★', sx, sy - h * 1.35);
        }
    }

    /** 벽면 박스 — 정면+우측면+윗면으로 입체를 낸다. */
    private drawBox(
        ctx: CanvasRenderingContext2D, sx: number, sy: number,
        w: number, h: number, wall: string, depth: number,
    ): void {
        ctx.fillStyle = this.adjustBrightness(wall, 0.72);
        ctx.fillRect(sx + w / 2 - depth, sy - h, depth, h);
        ctx.fillStyle = this.adjustBrightness(wall, 1.12);
        ctx.fillRect(sx - w / 2, sy - h, w, h * 0.12);
        ctx.fillStyle = wall;
        ctx.fillRect(sx - w / 2, sy - h * 0.88, w, h * 0.88);
    }

    /** 처마 — 위로 치솟은 팔작지붕 한 단 */
    private drawRoofTier(
        ctx: CanvasRenderingContext2D, cx: number, y: number,
        w: number, rise: number, color: string,
    ): void {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx - w / 2 - 4, y);
        ctx.quadraticCurveTo(cx - w / 4, y - rise * 0.4, cx, y - rise);
        ctx.quadraticCurveTo(cx + w / 4, y - rise * 0.4, cx + w / 2 + 4, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = this.adjustBrightness(color, 1.25);
        ctx.fillRect(cx - w / 2, y - 2, w, 2);
    }

    /** 창문 — 밤이 깊을수록 따뜻하게 점등된다. */
    private drawWindow(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, night: number): void {
        const glow = Math.round(200 + night * 55);
        ctx.fillStyle = night > 0.05
            ? `rgb(${glow},${Math.round(150 + night * 60)},${Math.round(90 + night * 30)})`
            : '#3a3f4a';
        ctx.fillRect(x, y, w, h);
        if (night > 0.45) {
            ctx.save();
            ctx.shadowColor = '#ffca6a';
            ctx.shadowBlur = 8;
            ctx.fillStyle = 'rgba(255, 202, 106, 0.85)';
            ctx.fillRect(x, y, w, h);
            ctx.restore();
        }
    }

    /** 누각/사찰 — 2단 팔작지붕 + 기둥 + 창문 */
    private drawPagoda(
        ctx: CanvasRenderingContext2D, sx: number, sy: number,
        w: number, h: number, building: CityBuilding, night: number, tiers: number, temple = false,
    ): void {
        const wallH = h * 0.62;
        this.drawBox(ctx, sx, sy, w, wallH, temple ? this.adjustBrightness(building.color, 1.05) : building.color, 6);
        ctx.fillStyle = temple ? '#8B0000' : '#5a3d28';
        ctx.fillRect(sx - w / 2 + 3, sy - wallH, 3, wallH);
        ctx.fillRect(sx + w / 2 - 6, sy - wallH, 3, wallH);
        this.drawWindow(ctx, sx - w * 0.32, sy - wallH * 0.72, w * 0.16, wallH * 0.3, night);
        this.drawWindow(ctx, sx + w * 0.16, sy - wallH * 0.72, w * 0.16, wallH * 0.3, night);
        ctx.fillStyle = '#241a12';
        ctx.fillRect(sx - w * 0.08, sy - wallH * 0.45, w * 0.16, wallH * 0.45);
        let topY = sy - wallH;
        let tierW = w;
        for (let i = 0; i < tiers; i++) {
            const rise = h * (0.28 - i * 0.05);
            this.drawRoofTier(ctx, sx, topY, tierW, rise, building.roofColor);
            topY -= rise * 0.82;
            tierW *= 0.62;
            if (i < tiers - 1) {
                this.drawBox(ctx, sx, topY + rise * 0.18, tierW, rise * 0.5, building.color, 4);
            }
        }
        if (temple) {
            ctx.fillStyle = '#FFD700';
            ctx.fillRect(sx - 1, topY - 8, 2, 8);
            ctx.beginPath();
            ctx.arc(sx, topY - 9, 2.5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /** 민가/병영/시장/공방 — 박스 + 맞배지붕 + 창문 */
    private drawHouse(
        ctx: CanvasRenderingContext2D, sx: number, sy: number,
        w: number, h: number, building: CityBuilding, night: number,
    ): void {
        this.drawBox(ctx, sx, sy, w, h * 0.72, building.color, 5);
        this.drawRoofTier(ctx, sx, sy - h * 0.72, w * 1.02, h * 0.34, building.roofColor);
        this.drawWindow(ctx, sx - w * 0.3, sy - h * 0.55, w * 0.18, h * 0.22, night);
        this.drawWindow(ctx, sx + w * 0.12, sy - h * 0.55, w * 0.18, h * 0.22, night);
        ctx.fillStyle = '#241a12';
        ctx.fillRect(sx - w * 0.07, sy - h * 0.36, w * 0.14, h * 0.36);
    }

    /** 농지 — 낮은 밭 + 작물 열 */
    private drawField(
        ctx: CanvasRenderingContext2D, sx: number, sy: number,
        w: number, h: number, building: CityBuilding, night: number,
    ): void {
        void night;
        ctx.fillStyle = '#5a4028';
        ctx.fillRect(sx - w / 2, sy - h * 0.2, w, h * 0.2);
        ctx.fillStyle = building.color;
        for (let i = 0; i < 4; i++) {
            const y = sy - h * 0.2 + 3 + i * ((h * 0.2 - 4) / 4);
            ctx.fillRect(sx - w / 2 + 3, y, w - 6, 2);
        }
        ctx.fillStyle = '#7CB342';
        for (let i = 0; i < 6; i++) {
            ctx.beginPath();
            ctx.arc(sx - w / 2 + 6 + i * ((w - 12) / 5), sy - h * 0.24, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    /** 성벽 — 낮은 담 + 여장 */
    private drawWall(
        ctx: CanvasRenderingContext2D, sx: number, sy: number,
        w: number, h: number, building: CityBuilding,
    ): void {
        const wallH = Math.max(8, h * 0.4);
        ctx.fillStyle = building.color;
        ctx.fillRect(sx - w / 2, sy - wallH, w, wallH);
        ctx.fillStyle = building.roofColor;
        for (let i = 0; i < 5; i++) {
            ctx.fillRect(sx - w / 2 + (i * w) / 5 + 1, sy - wallH - 5, w / 5 - 2, 5);
        }
    }

    /** 타입별 옥외 소품 — 깃발·차양·굴뚝·제등 */
    private drawTypeProp(
        ctx: CanvasRenderingContext2D, sx: number, sy: number,
        w: number, h: number, building: CityBuilding, night: number,
    ): void {
        switch (building.type) {
            case 'BARRACKS': {
                ctx.fillStyle = '#4a3a28';
                ctx.fillRect(sx + w / 2 - 8, sy - h * 1.1, 2, h * 1.1);
                ctx.fillStyle = building.level >= 3 ? '#c0392b' : '#7a6a4a';
                ctx.fillRect(sx + w / 2 - 8, sy - h * 1.1, 12, 7);
                break;
            }
            case 'MARKET': {
                for (let i = 0; i < 5; i++) {
                    ctx.fillStyle = i % 2 === 0 ? '#b03a2e' : '#e8dcc0';
                    ctx.fillRect(sx - w / 2 + (i * w) / 5, sy - h * 0.28, w / 5, 5);
                }
                break;
            }
            case 'TEMPLE': {
                this.drawLantern(ctx, sx - w / 2 - 8, sy, 1, night);
                this.drawLantern(ctx, sx + w / 2 + 8, sy, 1, night);
                break;
            }
            case 'WORKSHOP': {
                ctx.fillStyle = '#555560';
                ctx.fillRect(sx + w * 0.28, sy - h * 1.05, 6, h * 0.4);
                ctx.fillStyle = 'rgba(200, 200, 200, 0.5)';
                ctx.beginPath();
                ctx.arc(sx + w * 0.28 + 3, sy - h * 1.1, 3, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            default:
                break;
        }
    }

    /** 석등 — 밤에 발광한다. 장식물·사찰 소품 공용 */
    private drawLantern(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, night: number): void {
        ctx.fillStyle = '#6a6a72';
        ctx.fillRect(x - 2 * size, y - 12 * size, 4 * size, 12 * size);
        ctx.fillRect(x - 4 * size, y - 14 * size, 8 * size, 2 * size);
        const glow = night > 0.05;
        ctx.fillStyle = glow ? '#ffca6a' : '#8a7a5a';
        if (glow) {
            ctx.save();
            ctx.shadowColor = '#ffca6a';
            ctx.shadowBlur = 10;
            ctx.fillRect(x - 2.5 * size, y - 12 * size, 5 * size, 5 * size);
            ctx.restore();
        } else {
            ctx.fillRect(x - 2.5 * size, y - 12 * size, 5 * size, 5 * size);
        }
    }

    /** 장식 1개 렌더 — 건물보다 먼저 그려 뒤에 깔린다. */
    renderDecor(
        ctx: CanvasRenderingContext2D, decor: CityDecor,
        tileWidth: number, tileHeight: number, night: number, blossom: string,
    ): void {
        const s = decor.size;
        const { sx, sy } = this.worldToScreen(decor.x, decor.y, tileWidth, tileHeight);
        if (decor.kind === 'pond') {
            ctx.fillStyle = night > 0.5 ? '#1d3a5f' : '#4a90b8';
            ctx.beginPath();
            ctx.ellipse(sx, sy, 46 * s, 20 * s, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = night > 0.5 ? 'rgba(180, 210, 255, 0.5)' : 'rgba(255, 255, 255, 0.45)';
            ctx.beginPath();
            ctx.ellipse(sx - 10 * s, sy - 4 * s, 12 * s, 4 * s, -0.2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        if (decor.kind === 'rock') {
            ctx.fillStyle = '#7a7a82';
            ctx.beginPath();
            ctx.moveTo(sx - 9 * s, sy);
            ctx.lineTo(sx - 3 * s, sy - 12 * s);
            ctx.lineTo(sx + 6 * s, sy - 8 * s);
            ctx.lineTo(sx + 9 * s, sy);
            ctx.closePath();
            ctx.fill();
            return;
        }
        if (decor.kind === 'lantern') {
            this.drawLantern(ctx, sx, sy, s, night);
            return;
        }
        ctx.fillStyle = '#4a3a28';
        ctx.fillRect(sx - 1.5 * s, sy - 10 * s, 3 * s, 10 * s);
        if (decor.kind === 'blossom') {
            ctx.fillStyle = night > 0.5 ? '#8a5a72' : blossom;
            for (const [dx, dy, r] of [[-7, -14, 6], [0, -18, 7], [7, -14, 6], [-3, -11, 5], [4, -11, 5]] as const) {
                ctx.beginPath();
                ctx.arc(sx + dx * s, sy + dy * s, r * s, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            ctx.fillStyle = night > 0.5 ? '#1d4a2a' : '#2e6b3a';
            for (let i = 0; i < 3; i++) {
                const w = (12 - i * 3) * s;
                const y = sy - 10 * s - i * 7 * s;
                ctx.beginPath();
                ctx.moveTo(sx - w / 2, y);
                ctx.lineTo(sx, y - 8 * s);
                ctx.lineTo(sx + w / 2, y);
                ctx.closePath();
                ctx.fill();
            }
        }
    }

    /** 야간 틴트 — 건물·라벨 위에 얹어 밤 분위기를 낸다. */
    applyNightTint(ctx: CanvasRenderingContext2D, width: number, height: number, night: number): void {
        if (night <= 0.02) return;
        ctx.fillStyle = `rgba(8, 12, 48, ${(night * 0.42).toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
    }

    /** 전체 도시 렌더링 */
    renderCity(
        ctx: CanvasRenderingContext2D,
        buildings: CityBuilding[],
        season: Season,
        _timeOfDay: string = 'DAY',
    ): void {
        const colors = SEASON_COLORS[season];

        // 배경 (지면)
        ctx.fillStyle = colors.ground;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        // 건물 렌더링 (y 기준 정렬)
        const sorted = [...buildings].sort((a, b) => (a.x + a.y) - (b.x + b.y));
        for (const building of sorted) {
            this.renderBuilding(ctx, building, 64, 32);
        }
    }
}
