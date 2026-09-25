/**
 * [D32] 3D 도시 전경 렌더링 — City 3D Renderer
 *
 * City3DRenderer:
 *   - 등각투영(Isometric) 뷰
 *   - 건물 레벨 1~5 (크기/지붕장식/색상 변화)
 *   - 계절별 건물 색상
 *   - screenX = (x - y) * tileWidth/2, screenY = (x + y) * tileHeight/2
 */
const BUILDING_DEFS = {
    GOVERNMENT: { label: '관청', baseWidth: 60, baseHeight: 50 },
    BARRACKS: { label: '병영', baseWidth: 50, baseHeight: 40 },
    MARKET: { label: '시장', baseWidth: 40, baseHeight: 35 },
    FARM: { label: '농지', baseWidth: 50, baseHeight: 30 },
    TEMPLE: { label: '사원', baseWidth: 35, baseHeight: 45 },
    WORKSHOP: { label: '공방', baseWidth: 40, baseHeight: 35 },
    WALL: { label: '성벽', baseWidth: 80, baseHeight: 15 },
    HOUSE: { label: '주택', baseWidth: 30, baseHeight: 25 },
};
const SEASON_COLORS = {
    SPRING: { roof: '#8BAA6E', wall: '#D4C5A9', ground: '#7CB342' },
    SUMMER: { roof: '#5B8C4E', wall: '#C4B599', ground: '#558B2F' },
    AUTUMN: { roof: '#B8864E', wall: '#BFA580', ground: '#8D6E3F' },
    WINTER: { roof: '#E8E8F0', wall: '#D4D0C8', ground: '#BDBDBD' },
};
export class City3DRenderer {
    /** 도시 건물 배치 생성 */
    generateCityLayout(cityId, developmentLevel, season, savedStates = {}) {
        const buildings = [];
        const colors = SEASON_COLORS[season];
        const buildingCount = Math.max(5, Math.floor(developmentLevel * 2));
        // 건물 타입 가중치
        const typePool = [];
        for (const t of ['GOVERNMENT', 'BARRACKS', 'MARKET', 'FARM', 'TEMPLE', 'WORKSHOP', 'WALL', 'HOUSE', 'HOUSE', 'HOUSE', 'HOUSE']) {
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
    getBuildingColor(buildingType, level, season) {
        const colors = SEASON_COLORS[season];
        const levelBrightness = 0.7 + level * 0.06;
        const wallColor = this.adjustBrightness(colors.wall, levelBrightness);
        let roofColor;
        switch (buildingType) {
            case 'GOVERNMENT':
                roofColor = this.adjustBrightness('#8B0000', levelBrightness);
                break;
            case 'BARRACKS':
                roofColor = this.adjustBrightness('#4A4A4A', levelBrightness);
                break;
            case 'TEMPLE':
                roofColor = this.adjustBrightness('#DAA520', levelBrightness);
                break;
            case 'MARKET':
                roofColor = this.adjustBrightness('#CD853F', levelBrightness);
                break;
            case 'WALL':
                roofColor = this.adjustBrightness('#8B8378', levelBrightness);
                break;
            default: roofColor = colors.roof;
        }
        return { wall: wallColor, roof: roofColor };
    }
    /** 밝기 조정 */
    adjustBrightness(hex, factor) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        const nr = Math.min(255, Math.floor(r * factor));
        const ng = Math.min(255, Math.floor(g * factor));
        const nb = Math.min(255, Math.floor(b * factor));
        return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
    }
    /** 등각투영 좌표 변환 */
    worldToScreen(x, y, tileWidth = 64, tileHeight = 32) {
        return {
            sx: (x - y) * tileWidth / 2,
            sy: (x + y) * tileHeight / 2,
        };
    }
    /** 빌딩 렌더링 (캔버스 2D) */
    renderBuilding(ctx, building, tileWidth, tileHeight) {
        const { sx, sy } = this.worldToScreen(building.x, building.y, tileWidth, tileHeight);
        // 벽
        ctx.fillStyle = building.color;
        ctx.fillRect(sx - building.width / 2, sy - building.height, building.width, building.height);
        // 지붕 (삼각형)
        ctx.fillStyle = building.roofColor;
        ctx.beginPath();
        ctx.moveTo(sx - building.width / 2, sy - building.height);
        ctx.lineTo(sx, sy - building.height - building.height * 0.4);
        ctx.lineTo(sx + building.width / 2, sy - building.height);
        ctx.closePath();
        ctx.fill();
        // 레벨 표시 (별)
        if (building.level >= 4) {
            ctx.fillStyle = '#FFD700';
            ctx.font = '10px serif';
            ctx.textAlign = 'center';
            ctx.fillText('★', sx, sy - building.height - 10);
        }
    }
    /** 전체 도시 렌더링 */
    renderCity(ctx, buildings, season, _timeOfDay = 'DAY') {
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
//# sourceMappingURL=city_3d_renderer.js.map