/**
 * [Phase 3] 중국 전도 월드 렌더러 — ChinaMapRenderer
 *
 * 헥사곤 그리드 대신, 중국 본토 전도 위에 도시를 실제 지리 좌표에
 * 자유 배치하고 클릭으로 선택하는 삼국지8 본가 스타일 전략 맵.
 * 도시: 성 아이콘 + 소속기 색 + 병력 배지. 강/해안은 장식 윤곽으로 연출.
 */
export interface MapCityView {
    id: string;
    name: string;
    x: number;
    y: number;
    /** [지도][1:1] 이미지 속 성 아이콘 앵커 좌표 */
    imageX?: number;
    imageY?: number;
    iconType?: 'CAPITAL' | 'CITY' | 'PASS' | 'BATTLEFIELD' | 'PORT';
    /** 이미지 성 아이콘의 클릭 히트반경 — CSS/배킹스케일에 맞춰 확대한다. */
    hitRadius?: number;
    ownerColor: string;
    /** 소속 세력 이름 (영토 라벨 표시용) */
    factionName?: string;
    isPlayer: boolean;
    garrison: number;
    isSelected?: boolean;
    /** [49][461-480] 방문했거나 플레이어 세력이 소유한 도시인지 여부 */
    isDiscovered?: boolean;
    /** [49] 방문·소유 도시와 지리적으로 인접한 미방문 도시 — 발견 모드에서 실루엣으로 표시 */
    isAdjacentToDiscovered?: boolean;
    /** [321-340] 지도 날씨 오버레이 — 도시 타일 상단 날씨 아이콘 (미지정 시 미표시) */
    weather?: string;
    /** [321-340] 수확 보정 (0.5~1.2). 1.0 미만이면 악천후 색상 표시 */
    harvestModifier?: number;
    /** [461-480] 색약 친화 무늬 — 영토 셀에 사선/점 패턴을 얹어 소유 세력을 색 외 요소로 구분 */
    factionPattern?: 'none' | 'hatch' | 'dots' | 'border';
}
export interface ChinaMapView {
    offsetX: number;
    offsetY: number;
    zoom: number;
}
/**
 * 점이 다각형 내부에 있는지 검사 (짝수 교차법).
 * 영토 보로노이 셀을 대륙 윤곽으로 제한하는 데 사용.
 */
export declare function pointInPolygon(px: number, py: number, polygon: Array<{
    x: number;
    y: number;
}>): boolean;
export declare class ChinaMapRenderer {
    private canvas;
    private ctx;
    private offsetX;
    private offsetY;
    private zoom;
    private hoveredCityId;
    private cities;
    /** [49] 전체 도시 표시(초기) / 방문·소유 도시만 표시(발견 모드) */
    private discoveredOnly;
    /** 제공된 전국지도 배경 이미지 — 좌표계는 이미지 전체 영역을 기준으로 정규화한다. */
    private readonly mapImage;
    private mapImageReady;
    /** [321-340] 지도 날씨 오버레이 표시 여부 (기본 on) */
    private showWeatherOverlay;
    /** [1057][321-340] 계절 톤 — 봄/여름/가을/겨울에 따라 대륙 색조 보정 (null=보정 없음) */
    private seasonTint;
    /** 영토 셀 (보로노이 근사 그리드) 캐시 */
    private territoryCells;
    private territoryCols;
    private territoryRows;
    private territoryDirty;
    /** 세력 라벨 (영토 무게중심 + 크기) — rebuildTerritory에서 산출 */
    private factionLabels;
    /** 오프스크린 영토/경계 레이어 (확대 보간용) */
    private territoryLayer;
    private borderLayer;
    private territoryLayerDirty;
    private borderLayerDirty;
    private static readonly CELL_SIZE;
    constructor(canvas: HTMLCanvasElement);
    /** 지도 이미지 로딩 상태 — E2E/실행 화면에서 비동기 자산 readiness를 확인한다. */
    isMapImageReady(): boolean;
    setView(view: Partial<ChinaMapView>): void;
    /** 지도 카메라 상태를 도시 화면 전환 후 복원하기 위해 반환한다. */
    getView(): ChinaMapView;
    setCities(cities: MapCityView[]): void;
    /** [49] 초기에는 전체 도시, 이후 방문·소유 도시만 표시하는 필터. */
    setDiscoveredOnly(discoveredOnly: boolean): void;
    isCityVisible(city: MapCityView): boolean;
    /** 현재 필터에서 실제로 표시되는 도시 ID — E2E/디버그 검증용. */
    getVisibleCityIds(): string[];
    private visibleCities;
    /**
     * 영토 격자 재계산 — 도시 위치 기반 보로노이 근사.
     * 대륙 윤곽 내부의 셀만 가장 가까운 도시의 소속 색으로 채운다.
     */
    private rebuildTerritory;
    setHoveredCity(id: string | null): void;
    private mapImageRect;
    private normToPixel;
    private cityMapToPixel;
    private drawMapImage;
    /** 화면 픽셀 → 정규화 좌표 (역변환) */
    screenToNorm(px: number, py: number): {
        x: number;
        y: number;
    };
    /**
     * 픽셀 좌표 아래의 도시를 찾는다 (없으면 null)
     */
    cityAt(px: number, py: number): MapCityView | null;
    /** 도시의 현재 캔버스 픽셀 좌표 — 실제 입력 E2E와 접근성 검증에서 사용한다. */
    getCityScreenPosition(cityId: string): {
        x: number;
        y: number;
    } | null;
    render(): void;
    /**
     * 영토 레이어 — 저해상도 오프스크린 캔버스에 셀 색을 칠한 뒤
     * 메인 캔버스로 확대 블릿(imageSmoothing 보간). 셀 계단이
     * 자연스럽게 그라데이션처럼 블렌딩되어 부드러운 경계가 된다.
     */
    private drawTerritory;
    /**
     * 영토 오프스크린 레이어 생성/갱신.
     * 해상도: 대략 셀당 3~4픽셀 (확대 시 보간으로 부드러워짐).
     * 색은 최종 알파(플레이어 0.34 / 일반 0.22)를 미리 곱해 담는다.
     */
    private getTerritoryLayer;
    /**
     * 세력 경계선 — 셀 가장자리 선 대신, 저해상도 경계 마스크를
     * 확대 보간해 부드러운 음영 밴드로 표현.
     * 경계 마스크: 이웃 셀과 소속이 다른 셀에 밝은 픽셀을 찍고,
     * 확대 시 곡선처럼 흐르는 어두운 띠가 된다.
     */
    private drawTerritoryBorders;
    /**
     * 세력명 라벨 — 영토 무게중심에 반투명 대형 글씨로 표기.
     * 글자 크기는 영토 셀 수(면적)에 비례. 도시 뒤, 지형 앞에 얹힌다.
     */
    private drawFactionLabels;
    /** HEX 색을 밝게 섞는 헬퍼 (t: 0~1, 1에 가까울수록 흰색) */
    private lightenColor;
    /**
     * [321-340] 지도 날씨 오버레이 — 각 도시 위치에 날씨 아이콘을 그리고,
     * 수확 보정 0.8 미만 악천후 도시에는 경고 링을 표시한다.
     */
    private drawWeatherOverlay;
    /** 지도 날씨 오버레이 표시 토글 [321-340] (기본 on) */
    setShowWeatherOverlay(show: boolean): void;
    /**
     * [1057][321-340] 계절 톤 설정 — 대륙/바다 색조를 계절에 맞게 보정.
     * @param season 'spring'|'summer'|'autumn'|'winter' 또는 null(보정 해제)
     */
    setSeasonTint(season: 'spring' | 'summer' | 'autumn' | 'winter' | null): void;
    /** 계절별 대륙 색 보정 — 태평성세/설한/황염의 계절감 표현 */
    private applySeasonTint;
    /** [49] 미발견 도시의 흐림·실루엣 표현 — 소유 색/병력/날씨는 숨긴다. */
    private drawUndiscoveredCity;
    private drawCity;
    pan(dx: number, dy: number): void;
    zoomAt(factor: number, centerPx: number, centerPy: number): void;
    private baseScale;
    /** 테스트/디버그용: 현재 지도에 표시되는 세력 라벨 목록 */
    getFactionLabels(): Array<{
        name: string;
        color: string;
        cells: number;
        isPlayer: boolean;
    }>;
    /** 테스트/디버그용: 현재 영토 셀 통계 */
    getTerritoryStats(): {
        total: number;
        colored: number;
    };
    getState(): ChinaMapView;
}
//# sourceMappingURL=china_map_renderer.d.ts.map