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
export type CityBuildingType = 'GOVERNMENT' | 'BARRACKS' | 'MARKET' | 'FARM' | 'TEMPLE' | 'WORKSHOP' | 'WALL' | 'HOUSE';
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
export declare class City3DRenderer {
    /** 도시 건물 배치 생성 */
    generateCityLayout(cityId: CityID, developmentLevel: number, season: Season, savedStates?: Record<string, {
        level: number;
        investment: number;
        active: boolean;
    }>): CityBuilding[];
    /** 건물 색상 (계절/레벨 기반) */
    getBuildingColor(buildingType: CityBuildingType, level: number, season: Season): {
        wall: string;
        roof: string;
    };
    /** 밝기 조정 */
    private adjustBrightness;
    /** 등각투영 좌표 변환 */
    worldToScreen(x: number, y: number, tileWidth?: number, tileHeight?: number): {
        sx: number;
        sy: number;
    };
    /** 빌딩 렌더링 (캔버스 2D) */
    renderBuilding(ctx: CanvasRenderingContext2D, building: CityBuilding, tileWidth: number, tileHeight: number): void;
    /** 전체 도시 렌더링 */
    renderCity(ctx: CanvasRenderingContext2D, buildings: CityBuilding[], season: Season, _timeOfDay?: string): void;
}
//# sourceMappingURL=city_3d_renderer.d.ts.map