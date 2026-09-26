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
    x: number;              // 정규화 0~1
    y: number;              // 정규화 0~1
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

// ============================================================
// 기하 헬퍼
// ============================================================

/**
 * 점이 다각형 내부에 있는지 검사 (짝수 교차법).
 * 영토 보로노이 셀을 대륙 윤곽으로 제한하는 데 사용.
 */
export function pointInPolygon(px: number, py: number, polygon: Array<{ x: number; y: number }>): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x;
        const yi = polygon[i].y;
        const xj = polygon[j].x;
        const yj = polygon[j].y;
        const intersects = ((yi > py) !== (yj > py))
            && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

// ============================================================
// 지형 장식 (강 흐름 — 정규화 좌표 폴리라인)
// ============================================================

const RIVERS: Array<Array<{ x: number; y: number }>> = [
    // 황하 (상류 → 하류, 几字 형태 단순화)
    [
        { x: 0.30, y: 0.30 }, { x: 0.33, y: 0.24 }, { x: 0.38, y: 0.20 },
        { x: 0.43, y: 0.22 }, { x: 0.45, y: 0.28 }, { x: 0.50, y: 0.30 },
        { x: 0.55, y: 0.28 }, { x: 0.60, y: 0.26 }, { x: 0.68, y: 0.22 },
        { x: 0.76, y: 0.20 }, { x: 0.85, y: 0.24 },
    ],
    // 장강 (상류 → 하류)
    [
        { x: 0.26, y: 0.52 }, { x: 0.32, y: 0.54 }, { x: 0.40, y: 0.52 },
        { x: 0.48, y: 0.55 }, { x: 0.55, y: 0.58 }, { x: 0.62, y: 0.60 },
        { x: 0.70, y: 0.62 }, { x: 0.78, y: 0.66 }, { x: 0.88, y: 0.70 },
    ],
    // 회수
    [
        { x: 0.55, y: 0.44 }, { x: 0.62, y: 0.48 }, { x: 0.70, y: 0.50 },
    ],
];

/** 대륙 윤곽 (간략화된 중국 본토 폴리곤, 정규화 좌표) */
const CONTINENT_OUTLINE: Array<{ x: number; y: number }> = [
    { x: 0.16, y: 0.20 }, { x: 0.30, y: 0.12 }, { x: 0.50, y: 0.08 },
    { x: 0.70, y: 0.06 }, { x: 0.88, y: 0.12 }, { x: 0.94, y: 0.24 },
    { x: 0.90, y: 0.36 }, { x: 0.94, y: 0.48 }, { x: 0.90, y: 0.62 },
    { x: 0.82, y: 0.72 }, { x: 0.70, y: 0.80 }, { x: 0.58, y: 0.84 },
    { x: 0.48, y: 0.88 }, { x: 0.38, y: 0.86 }, { x: 0.28, y: 0.80 },
    { x: 0.20, y: 0.70 }, { x: 0.14, y: 0.58 }, { x: 0.10, y: 0.44 },
    { x: 0.12, y: 0.32 },
];

// ============================================================
// ChinaMapRenderer
// ============================================================

export class ChinaMapRenderer {
    private canvas: HTMLCanvasElement;
    private ctx: CanvasRenderingContext2D;
    private offsetX = 0;
    private offsetY = 0;
    private zoom = 1.0;
    private hoveredCityId: string | null = null;
    private cities: MapCityView[] = [];
    /** [49] 전체 도시 표시(초기) / 방문·소유 도시만 표시(발견 모드) */
    private discoveredOnly = false;

    /** [321-340] 지도 날씨 오버레이 표시 여부 (기본 on) */
    private showWeatherOverlay = true;

    /** [1057][321-340] 계절 톤 — 봄/여름/가을/겨울에 따라 대륙 색조 보정 (null=보정 없음) */
    private seasonTint: 'spring' | 'summer' | 'autumn' | 'winter' | null = null;

    /** 영토 셀 (보로노이 근사 그리드) 캐시 */
    private territoryCells: Array<{ ownerColor: string | null; cityId: string | null; isPlayer: boolean; pattern: string }> = [];
    private territoryCols = 0;
    private territoryRows = 0;
    private territoryDirty = true;

    /** 세력 라벨 (영토 무게중심 + 크기) — rebuildTerritory에서 산출 */
    private factionLabels: Array<{ name: string; color: string; cx: number; cy: number; cells: number; isPlayer: boolean }> = [];

    /** 오프스크린 영토/경계 레이어 (확대 보간용) */
    private territoryLayer: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number } | null = null;
    private borderLayer: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; width: number; height: number } | null = null;
    private territoryLayerDirty = true;
    private borderLayerDirty = true;

    private static readonly CELL_SIZE = 0.014; // 정규화 공간 격자 간격 (≈72×72 격자) [269]

    /** [지도][1:1] Natural Earth 실제 지형 비트맵. 미로딩이면 스케치 지도로 폴백. */
    private mapImage: HTMLImageElement | null = null;

    /** 육지 마스크 — 영토를 바다에 칠하지 않게 하는 알파 마스크. 비트맵에서 추출. */
    private landMask: HTMLCanvasElement | null = null;

    /** 육지 판정용 마스크 알파 (0=바다, 255=육지). getLandMask가 함께 채운다. */
    private landAlpha: Uint8Array | null = null;

    /** 지도 위에 곱해 낡은 종이감을 만드는 텍스처. 미로딩이면 생략. */
    private paperTexture: HTMLImageElement | null = null;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        if (typeof Image === 'undefined') return;
        const img = new Image();
        img.addEventListener('load', () => {
            this.mapImage = img;
            this.landMask = null;
            this.landAlpha = null;
            // 육지 판정 기준이 바뀌므로 영토·경계·라벨을 다시 만든다
            this.territoryDirty = true;
            this.territoryLayerDirty = true;
            this.borderLayerDirty = true;
        });
        img.src = 'assets/map-china-4096.webp';
        const paper = new Image();
        paper.addEventListener('load', () => { this.paperTexture = paper; });
        paper.src = 'assets/map-parchment-1024.webp';
    }

    /**
     * 비트맵의 바다색을 투명 처리해 육지만 남기는 마스크를 만든다.
     * generate_map.py 의 SEAFILL 값과 일치해야 하며, 해안선 안티에일리어싱은 여유 있게 판정한다.
     */
    private getLandMask(): HTMLCanvasElement | null {
        if (!this.mapImage) return null;
        if (this.landMask) return this.landMask;
        const S = 256;
        const c = document.createElement('canvas');
        c.width = S;
        c.height = S;
        const cx = c.getContext('2d')!;
        cx.drawImage(this.mapImage, 0, 0, S, S);
        const px = cx.getImageData(0, 0, S, S).data;
        const img = cx.createImageData(S, S);
        for (let i = 0; i < S * S; i++) {
            const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
            const isSea = Math.abs(r - 198) < 26 && Math.abs(g - 214) < 26 && Math.abs(b - 214) < 26;
            const o = i * 4;
            img.data[o] = 255;
            img.data[o + 1] = 255;
            img.data[o + 2] = 255;
            img.data[o + 3] = isSea ? 0 : 255;
        }
        cx.putImageData(img, 0, 0);
        this.landMask = c;
        this.landAlpha = new Uint8Array(S * S);
        for (let i = 0; i < S * S; i++) this.landAlpha[i] = img.data[i * 4 + 3];
        return c;
    }

    /** 정규화 좌표가 육지인지 판정. 마스크 없으면 스케치 윤곽으로 폴백. */
    private isLand(nx: number, ny: number): boolean {
        if (this.mapImage) this.getLandMask();
        if (!this.landAlpha) return pointInPolygon(nx, ny, CONTINENT_OUTLINE);
        const S = 256;
        const px = Math.min(S - 1, Math.max(0, Math.floor(nx * S)));
        const py = Math.min(S - 1, Math.max(0, Math.floor(ny * S)));
        return this.landAlpha[py * S + px] > 127;
    }

    /** 영토/경계 레이어를 육지에만 남긴다. 마스크가 없으면 아무것도 하지 않는다. */
    private clipToLand(octx: CanvasRenderingContext2D, w: number, h: number): void {
        const mask = this.getLandMask();
        if (!mask) return;
        octx.globalCompositeOperation = 'destination-in';
        octx.drawImage(mask, 0, 0, w, h);
        octx.globalCompositeOperation = 'source-over';
    }

    setView(view: Partial<ChinaMapView>): void {
        if (view.offsetX !== undefined) this.offsetX = view.offsetX;
        if (view.offsetY !== undefined) this.offsetY = view.offsetY;
        if (view.zoom !== undefined) this.zoom = view.zoom;
    }

    /** 지도 카메라 상태를 도시 화면 전환 후 복원하기 위해 반환한다. */
    getView(): ChinaMapView {
        return { offsetX: this.offsetX, offsetY: this.offsetY, zoom: this.zoom };
    }

    setCities(cities: MapCityView[]): void {
        this.cities = cities;
        this.territoryDirty = true;
        this.territoryLayerDirty = true;
        this.borderLayerDirty = true;
    }

    /** [49] 초기에는 전체 도시, 이후 방문·소유 도시만 표시하는 필터. */
    setDiscoveredOnly(discoveredOnly: boolean): void {
        if (this.discoveredOnly === discoveredOnly) return;
        this.discoveredOnly = discoveredOnly;
        this.territoryDirty = true;
        this.territoryLayerDirty = true;
        this.borderLayerDirty = true;
    }

    isCityVisible(city: MapCityView): boolean {
        return !this.discoveredOnly
            || city.isPlayer
            || city.isDiscovered === true
            || city.isAdjacentToDiscovered === true;
    }

    /** 현재 필터에서 실제로 표시되는 도시 ID — E2E/디버그 검증용. */
    getVisibleCityIds(): string[] {
        return this.cities.filter(city => this.isCityVisible(city)).map(city => city.id);
    }

    private visibleCities(): MapCityView[] {
        return this.cities.filter(city => this.isCityVisible(city));
    }

    /**
     * 영토 격자 재계산 — 도시 위치 기반 보로노이 근사.
     * 대륙 윤곽 내부의 셀만 가장 가까운 도시의 소속 색으로 채운다.
     */
    private rebuildTerritory(): void {
        const cols = Math.ceil(1.0 / ChinaMapRenderer.CELL_SIZE);
        const rows = Math.ceil(1.0 / ChinaMapRenderer.CELL_SIZE);
        this.territoryCols = cols;
        this.territoryRows = rows;

        // [49] 세력 구분선·세력명은 발견 모드와 관계없이 전국의 모든 세력을 표시한다.
        const owned = this.cities.filter(c => c.ownerColor);

        const cells: Array<{ ownerColor: string | null; cityId: string | null; isPlayer: boolean; pattern: string }> = new Array(cols * rows);

        for (let gy = 0; gy < rows; gy++) {
            for (let gx = 0; gx < cols; gx++) {
                const nx = (gx + 0.5) * ChinaMapRenderer.CELL_SIZE;
                const ny = (gy + 0.5) * ChinaMapRenderer.CELL_SIZE;

                // 육지 판정 — 비트맵 마스크 우선, 없으면 스케치 윤곽 (홀짝 교차법)
                if (!this.isLand(nx, ny)) {
                    cells[gy * cols + gx] = { ownerColor: null, cityId: null, isPlayer: false, pattern: 'none' };
                    continue;
                }

                // 가장 가까운 소속 도시 탐색 (제곱거리 비교)
                let bestDist = Infinity;
                let bestCity: MapCityView | null = null;
                for (const city of owned) {
                    const c = this.cityNorm(city);
                    const dx = c.x - nx;
                    const dy = c.y - ny;
                    const d = dx * dx + dy * dy;
                    if (d < bestDist) {
                        bestDist = d;
                        bestCity = city;
                    }
                }

                cells[gy * cols + gx] = bestCity
                    ? { ownerColor: bestCity.ownerColor, cityId: bestCity.id, isPlayer: bestCity.isPlayer, pattern: bestCity.factionPattern ?? 'none' }
                    : { ownerColor: null, cityId: null, isPlayer: false, pattern: 'none' };
            }
        }

        this.territoryCells = cells;

        // ---- 세력 라벨 산출: 세력별 무게중심을 자기 영토 안으로 스냅 + 크기 ----
        // 순수 무게중심은 오목한 해안선에서 바다에 떨어진다 (한반도+일본 영토의 중심은 동해 한가운데).
        // BFS로 '가장 깊은 셀'을 고르면 영토가 지도 끝까지 뻔 세력이 북쪽 끝단에 라벨을 붙인다.
        // 무게중심에 가장 가까운 '내 소유 셀'을 고르면 바다가 나올 수 없고 시각적 중심도 유지된다.
        const acc = new Map<string, { name: string; color: string; sumX: number; sumY: number; n: number; isPlayer: boolean; mine: number[] }>();
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (!cell || !cell.ownerColor) continue;
            const city = owned.find(c => c.ownerColor === cell.ownerColor);
            if (!city) continue;
            const key = cell.ownerColor + '|' + (city.factionName ?? '');
            let a = acc.get(key);
            if (!a) {
                a = { name: city.factionName ?? '', color: cell.ownerColor, sumX: 0, sumY: 0, n: 0, isPlayer: city.isPlayer, mine: [] };
                acc.set(key, a);
            }
            a.sumX += ((i % cols) + 0.5) * ChinaMapRenderer.CELL_SIZE;
            a.sumY += (((i / cols) | 0) + 0.5) * ChinaMapRenderer.CELL_SIZE;
            a.n++;
            a.mine.push(i);
        }

        this.factionLabels = Array.from(acc.values())
            // 작은 세력도 전국 지도에서 세력명을 표시하고, 겹칠 때만 안티오버랩 처리로 생략한다.
            .filter(a => a.n >= 16)
            .map(a => {
                const ccx = a.sumX / a.n;
                const ccy = a.sumY / a.n;
                let best = a.mine[0];
                let bestD = Infinity;
                for (const i of a.mine) {
                    const dx = ((i % cols) + 0.5) * ChinaMapRenderer.CELL_SIZE - ccx;
                    const dy = (((i / cols) | 0) + 0.5) * ChinaMapRenderer.CELL_SIZE - ccy;
                    const d = dx * dx + dy * dy;
                    if (d < bestD) { bestD = d; best = i; }
                }
                return {
                    name: a.name,
                    color: a.color,
                    cx: ((best % cols) + 0.5) * ChinaMapRenderer.CELL_SIZE,
                    cy: (((best / cols) | 0) + 0.5) * ChinaMapRenderer.CELL_SIZE,
                    cells: a.n,
                    isPlayer: a.isPlayer,
                };
            });

        this.territoryDirty = false;
        this.territoryLayerDirty = true;
        this.borderLayerDirty = true;
    }

    setHoveredCity(id: string | null): void {
        this.hoveredCityId = id;
    }

    /**
     * 정규화 좌표(0~1) → 화면 픽셀 사각형.
     * 배경 비트맵 없이 스케치 데이터 지도 전용: 대륙 비율(1 : 0.92)에 맞춘 균일 배율.
     */
    private mapImageRect(width: number, height: number): { x: number; y: number; width: number; height: number } {
        const baseScale = Math.min(width / 1.0, height / 0.92) * 0.96 * this.zoom;
        return { x: width / 2 + this.offsetX - baseScale / 2, y: height / 2 + this.offsetY - baseScale * 0.46, width: baseScale, height: baseScale };
    }

    private normToPixel(x: number, y: number, width: number, height: number): { px: number; py: number } {
        const rect = this.mapImageRect(width, height);
        return { px: rect.x + x * rect.width, py: rect.y + y * rect.height };
    }

    /** 도시가 실제로 그려지는 정규화 좌표 — 비트맵 앵커가 있으면 그것을, 없으면 전술 좌표를 쓴다. */
    private cityNorm(city: MapCityView): { x: number; y: number } {
        return { x: city.imageX ?? city.x, y: city.imageY ?? city.y };
    }

    private cityMapToPixel(city: MapCityView, width: number, height: number): { px: number; py: number } {
        const n = this.cityNorm(city);
        return this.normToPixel(n.x, n.y, width, height);
    }

    /** 화면 픽셀 → 정규화 좌표 (역변환) */
    screenToNorm(px: number, py: number): { x: number; y: number } {
        const rect = this.mapImageRect(this.canvas.width, this.canvas.height);
        return {
            x: (px - rect.x) / rect.width,
            y: (py - rect.y) / rect.height,
        };
    }

    /**
     * 픽셀 좌표 아래의 도시를 찾는다 (없으면 null)
     */
    cityAt(px: number, py: number): MapCityView | null {
        const width = this.canvas.width;
        const height = this.canvas.height;
        const radius = 14 * this.zoom;
        let best: MapCityView | null = null;
        let bestDist = Infinity;
        for (const city of this.visibleCities()) {
            const { px: cx, py: cy } = this.cityMapToPixel(city, width, height);
            const d = Math.hypot(px - cx, py - cy);
            const hitRadius = (city.hitRadius ?? 16) * this.zoom;
            if (d < Math.max(radius + 6, hitRadius) && d < bestDist) {
                best = city;
                bestDist = d;
            }
        }
        return best;
    }

    /** 도시의 현재 캔버스 픽셀 좌표 — 실제 입력 E2E와 접근성 검증에서 사용한다. */
    getCityScreenPosition(cityId: string): { x: number; y: number } | null {
        const city = this.cities.find(item => item.id === cityId);
        if (!city || !this.isCityVisible(city)) return null;
        const point = this.cityMapToPixel(city, this.canvas.width, this.canvas.height);
        return { x: point.px, y: point.py };
    }

    render(): void {
        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        ctx.clearRect(0, 0, width, height);

        // ---- 배경 (바다색) ----
        ctx.fillStyle = '#0c0e1c';
        ctx.fillRect(0, 0, width, height);

        if (this.mapImage) {
            // 실제 지형 비트맵 [지도][1:1]
            const rect = this.mapImageRect(width, height);
            ctx.drawImage(this.mapImage, rect.x, rect.y, rect.width, rect.height);
            if (this.paperTexture) {
                ctx.save();
                ctx.globalCompositeOperation = 'multiply';
                ctx.globalAlpha = 0.38;
                ctx.drawImage(this.paperTexture, rect.x, rect.y, rect.width, rect.height);
                ctx.restore();
            }
            const tint = this.seasonTintOverlay(width, height);
            if (tint) {
                ctx.fillStyle = tint;
                ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
            }
        } else {
            // ---- 대륙 윤곽 (비트맵 미로딩 시 폴백) ----
            const outline: Array<[number, number]> = CONTINENT_OUTLINE.map(p => {
                const { px, py } = this.normToPixel(p.x, p.y, width, height);
                return [px, py] as [number, number];
            });

            ctx.beginPath();
            ctx.moveTo(outline[0][0], outline[0][1]);
            for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
            ctx.closePath();

            // 육지 그라데이션 (+계절 톤 보정 [1057][321-340])
            const landGrad = ctx.createLinearGradient(0, 0, width, height);
            landGrad.addColorStop(0, '#3a4430');
            landGrad.addColorStop(0.5, '#46523a');
            landGrad.addColorStop(1, '#37402e');
            ctx.fillStyle = this.applySeasonTint(landGrad);
            ctx.fill();

            // 해안선
            ctx.strokeStyle = 'rgba(220, 210, 170, 0.35)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // ---- 세력 영토 (도시 좌표에서 산출한 보로노이 근사) ----
        this.drawTerritory(ctx, width, height);

        // ---- [321-340] 지도 날씨 오버레이 — 도시 위 날씨 아이콘 + 악천후 수확 경고 ----
        this.drawWeatherOverlay(ctx, width, height);

        if (!this.mapImage) {
            // ---- 산맥 장식 (비트맵 미로딩 시 폴백) ----
            ctx.strokeStyle = 'rgba(150, 140, 110, 0.5)';
            ctx.lineWidth = 1.2;
            for (let i = 0; i < 5; i++) {
                const bx = 0.16 + i * 0.035;
                const { px, py } = this.normToPixel(bx, 0.34 + (i % 2) * 0.05, width, height);
                const size = 8 * this.zoom;
                ctx.beginPath();
                ctx.moveTo(px - size, py + size * 0.6);
                ctx.lineTo(px, py - size * 0.7);
                ctx.lineTo(px + size, py + size * 0.6);
                ctx.stroke();
            }

            // ---- 강 (비트맵 미로딩 시 폴백 — Natural Earth에 이미 하천이 있다) ----
            for (const river of RIVERS) {
                ctx.beginPath();
                river.forEach((p, i) => {
                    const { px, py } = this.normToPixel(p.x, p.y, width, height);
                    if (i === 0) ctx.moveTo(px, py);
                    else {
                        // 부드러운 곡선
                        const prev = river[i - 1];
                        const pp = this.normToPixel(prev.x, prev.y, width, height);
                        const cpx = (pp.px + px) / 2;
                        const cpy = (pp.py + py) / 2;
                        ctx.quadraticCurveTo(pp.px, pp.py, cpx, cpy);
                    }
                });
                const last = river[river.length - 1];
                const lp = this.normToPixel(last.x, last.y, width, height);
                ctx.lineTo(lp.px, lp.py);
                ctx.strokeStyle = 'rgba(90, 140, 190, 0.75)';
                ctx.lineWidth = Math.max(2, 4 * this.zoom);
                ctx.lineCap = 'round';
                ctx.stroke();
            }
        }

        // ---- 세력 경계선·세력명 (도시 좌표에서 산출한 데이터) ----
        this.drawTerritoryBorders(ctx, width, height);
        this.drawFactionLabels(ctx, width, height);

        // ---- 도시 ----
        for (const city of this.visibleCities()) {
            this.drawCity(ctx, city, width, height);
        }
    }

    /**
     * 영토 레이어 — 저해상도 오프스크린 캔버스에 셀 색을 칠한 뒤
     * 메인 캔버스로 확대 블릿(imageSmoothing 보간). 셀 계단이
     * 자연스럽게 그라데이션처럼 블렌딩되어 부드러운 경계가 된다.
     */
    private drawTerritory(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        if (this.territoryDirty) this.rebuildTerritory();

        const cellPx = ChinaMapRenderer.CELL_SIZE * this.baseScale();
        if (cellPx < 4) return; // 너무 작으면 생략 (성능 보호)

        const off = this.getTerritoryLayer(width, height);
        if (!off) return;

        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.globalAlpha = 1.0;
        // 영역 전체를 확대 그리기 — 저해상도 픽셀이 부드럽게 보간됨
        const rect = this.mapImageRect(width, height);
        ctx.drawImage(off.canvas, 0, 0, off.width, off.height, rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
    }

    /**
     * 영토 오프스크린 레이어 생성/갱신.
     * 해상도: 대략 셀당 3~4픽셀 (확대 시 보간으로 부드러워짐).
     * 색은 최종 알파(플레이어 0.34 / 일반 0.22)를 미리 곱해 담는다.
     */
    private getTerritoryLayer(width: number, height: number): { canvas: HTMLCanvasElement; width: number; height: number } | null {
        const scale = 0.25; // 메인 해상도의 25%
        const lw = Math.max(1, Math.floor(width * scale));
        const lh = Math.max(1, Math.floor(height * scale));

        let off = this.territoryLayer;
        if (!off || off.width !== lw || off.height !== lh) {
            const canvas = document.createElement('canvas');
            canvas.width = lw;
            canvas.height = lh;
            off = { canvas, ctx: canvas.getContext('2d')!, width: lw, height: lh };
            this.territoryLayer = off;
            this.territoryLayerDirty = true;
        }
        if (!this.territoryDirty && !this.territoryLayerDirty) return off;

        this.rebuildTerritory();
        const octx = off.ctx;
        octx.clearRect(0, 0, lw, lh);

        const cols = this.territoryCols;
        const rows = this.territoryRows;
        // 셀 하나가 오프스크린에서 차지하는 픽셀 크기
        const cellW = lw / cols;
        const cellH = lh / rows;

        for (let gy = 0; gy < rows; gy++) {
            for (let gx = 0; gx < cols; gx++) {
                const cell = this.territoryCells[gy * cols + gx];
                if (!cell || !cell.ownerColor) continue;
                octx.globalAlpha = cell.isPlayer ? 0.34 : 0.22;
                octx.fillStyle = cell.ownerColor;
                octx.fillRect(gx * cellW, gy * cellH, cellW + 0.6, cellH + 0.6);
                // [461-480] 색약 무늬 — 셀 위에 사선/점 패턴을 얹어 세력 이중 부호화
                if (cell.pattern === 'hatch') {
                    octx.strokeStyle = cell.ownerColor;
                    octx.lineWidth = 1;
                    octx.beginPath();
                    octx.moveTo(gx * cellW, gy * cellH + cellH);
                    octx.lineTo(gx * cellW + cellW, gy * cellH);
                    octx.stroke();
                } else if (cell.pattern === 'dots') {
                    octx.fillStyle = cell.ownerColor;
                    octx.beginPath();
                    octx.arc(gx * cellW + cellW / 2, gy * cellH + cellH / 2, 1.4, 0, Math.PI * 2);
                    octx.fill();
                }
            }
        }
        octx.globalAlpha = 1.0;
        this.clipToLand(octx, lw, lh);

        this.territoryLayerDirty = false;
        return off;
    }

    /**
     * 세력 경계선 — 셀 가장자리 선 대신, 저해상도 경계 마스크를
     * 확대 보간해 부드러운 음영 밴드로 표현.
     * 경계 마스크: 이웃 셀과 소속이 다른 셀에 밝은 픽셀을 찍고,
     * 확대 시 곡선처럼 흐르는 어두운 띠가 된다.
     */
    private drawTerritoryBorders(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        if (this.territoryDirty) this.rebuildTerritory();

        const cellPx = ChinaMapRenderer.CELL_SIZE * this.baseScale();
        if (cellPx < 4) return;

        const off = this.territoryLayer;
        if (!off) return;

        const scale = 0.25;
        const lw = off.width;
        const lh = off.height;

        // 경계 마스크 레이어 (캐시)
        let border = this.borderLayer;
        if (!border || border.width !== lw || border.height !== lh) {
            const canvas = document.createElement('canvas');
            canvas.width = lw;
            canvas.height = lh;
            border = { canvas, ctx: canvas.getContext('2d')!, width: lw, height: lh };
            this.borderLayer = border;
            this.borderLayerDirty = true;
        }
        if (!this.territoryDirty && !this.borderLayerDirty) {
            // 재사용
        } else {
            const bctx = border.ctx;
            bctx.clearRect(0, 0, lw, lh);

            const cols = this.territoryCols;
            const rows = this.territoryRows;
            const cellW = lw / cols;
            const cellH = lh / rows;
            const keyOfFaction = (cell: { ownerColor: string | null } | undefined): string => cell?.ownerColor ?? '';
            const keyOfCity = (cell: { cityId: string | null } | undefined): string => cell?.cityId ?? '';

            // 세력 구분선: 서로 다른 세력 영토를 어두운 굵은 경계로 분리한다.
            bctx.fillStyle = 'rgba(20, 16, 8, 0.62)';
            const factionLineW = Math.max(1, cellW * 0.5);

            for (let gy = 0; gy < rows; gy++) {
                for (let gx = 0; gx < cols; gx++) {
                    const cell = this.territoryCells[gy * cols + gx];
                    if (!cell || !cell.ownerColor) continue;

                    const x = gx * cellW;
                    const y = gy * cellH;
                    const right = this.territoryCells[gy * cols + gx + 1];
                    const down = this.territoryCells[(gy + 1) * cols + gx];

                    if (gx + 1 < cols && keyOfFaction(right) !== keyOfFaction(cell)) {
                        bctx.fillRect(x + cellW - factionLineW / 2, y - cellH * 0.5, factionLineW, cellH * 2);
                    }
                    if (gy + 1 < rows && keyOfFaction(down) !== keyOfFaction(cell)) {
                        bctx.fillRect(x - cellW * 0.5, y + cellH - factionLineW / 2, cellW * 2, factionLineW);
                    }

                    // 도시 구분선: 같은 세력 안에서도 서로 다른 도시 영토를 얇은 금색선으로 분리한다.
                    const cityLineW = Math.max(0.6, cellW * 0.22);
                    bctx.fillStyle = 'rgba(238, 214, 145, 0.52)';
                    if (gx + 1 < cols && keyOfFaction(right) === keyOfFaction(cell) && keyOfCity(right) !== keyOfCity(cell)) {
                        bctx.fillRect(x + cellW - cityLineW / 2, y - cellH * 0.5, cityLineW, cellH * 2);
                    }
                    if (gy + 1 < rows && keyOfFaction(down) === keyOfFaction(cell) && keyOfCity(down) !== keyOfCity(cell)) {
                        bctx.fillRect(x - cellW * 0.5, y + cellH - cityLineW / 2, cellW * 2, cityLineW);
                    }
                }
            }
            this.clipToLand(bctx, lw, lh);
            this.borderLayerDirty = false;
        }

        // 경계 마스크를 확대 블릿 — 저해상도 픽셀이 보간되며 부드러운 곡선 밴드가 됨
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        const rect = this.mapImageRect(width, height);
        ctx.drawImage(border.canvas, 0, 0, lw, lh, rect.x, rect.y, rect.width, rect.height);
        ctx.restore();
    }

    /**
     * 세력명 라벨 — 영토 무게중심에 반투명 대형 글씨로 표기.
     * 글자 크기는 영토 셀 수(면적)에 비례. 도시 뒤, 지형 앞에 얹힌다.
     */
    private drawFactionLabels(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        // [461-480] 안티오버랩: 플레이어 라벨 최우선 → 면적 내림차순으로 배치 검사,
        // 겹치는 라벨은 생략. 실측 measureText AABB 기반 판정.
        interface Placed { x: number; y: number; w: number; h: number; }
        const placed: Placed[] = [];
        const ordered = [...this.factionLabels].sort((a, b) =>
            (b.isPlayer ? 1 : 0) - (a.isPlayer ? 1 : 0) || b.cells - a.cells,
        );
        for (const label of ordered) {
            const { px, py } = this.normToPixel(label.cx, label.cy, width, height);
            if (px < -80 || px > width + 80 || py < -60 || py > height + 60) continue;

            // 영토 면적 기반 글자 크기 (최소 18px, 최대 64px)
            const fontSize = Math.max(18, Math.min(64, Math.sqrt(label.cells / 4096) * 448 * this.zoom));
            if (!label.name) continue;

            // 실측 텍스트 AABB — 패딩 포함 겹침 판정
            ctx.save();
            ctx.font = `bold ${fontSize}px "Malgun Gothic", sans-serif`;
            const tw = ctx.measureText(label.name).width;
            ctx.restore();
            const box: Placed = { x: px - tw / 2 - 6, y: py - fontSize / 2 - 4, w: tw + 12, h: fontSize + 8 };
            const overlaps = placed.some((p) =>
                box.x < p.x + p.w && box.x + box.w > p.x &&
                box.y < p.y + p.h && box.y + box.h > p.y,
            );
            if (overlaps) continue; // 우선순위 높은 라벨에 양보
            placed.push(box);

            ctx.save();
            ctx.font = `bold ${fontSize}px "Malgun Gothic", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // 자체 세력색보다 밝은 톤으로, 반투명하게
            const alpha = label.isPlayer ? 0.5 : 0.38;
            ctx.globalAlpha = alpha;
            ctx.fillStyle = this.lightenColor(label.color, 0.55);

            // 외곽 음영 (가독성)
            ctx.globalAlpha = Math.min(0.6, alpha + 0.15);
            ctx.strokeStyle = 'rgba(10, 8, 4, 0.8)';
            ctx.lineWidth = Math.max(2, fontSize * 0.08);
            ctx.strokeText(label.name, px, py);

            ctx.globalAlpha = alpha;
            ctx.fillText(label.name, px, py);
            ctx.restore();
        }
    }

    /** HEX 색을 밝게 섞는 헬퍼 (t: 0~1, 1에 가까울수록 흰색) */
    private lightenColor(hex: string, t: number): string {
        const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
        if (!m) return hex;
        const r = Math.round(parseInt(m[1], 16) + (255 - parseInt(m[1], 16)) * t);
        const g = Math.round(parseInt(m[2], 16) + (255 - parseInt(m[2], 16)) * t);
        const b = Math.round(parseInt(m[3], 16) + (255 - parseInt(m[3], 16)) * t);
        return `rgb(${r}, ${g}, ${b})`;
    }

    /**
     * [321-340] 지도 날씨 오버레이 — 각 도시 위치에 날씨 아이콘을 그리고,
     * 수확 보정 0.8 미만 악천후 도시에는 경고 링을 표시한다.
     */
    private drawWeatherOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
        if (!this.showWeatherOverlay) return;
        const icons: Record<string, string> = {
            SUNNY: '☀️', CLOUDY: '☁️', RAIN: '🌧️', STORM: '⛈️', SNOW: '❄️', FOG: '🌫️', HEATWAVE: '🔥',
        };
        const s = this.zoom;
        for (const city of this.visibleCities()) {
            // [49] 전체 모드의 미발견 도시는 위치만 흐릿한 실루엣으로 남긴다.
            if (city.isDiscovered === false) continue;
            if (!city.weather) continue;
            const { px, py } = this.cityMapToPixel(city, width, height);
            const margin = 60 * s;
            if (px < -margin || px > width + margin || py < -margin || py > height + margin) continue;
            // 도시 아이콘 좌상단에 날씨 표시 — 성 아이콘과 겹침 방지
            const wx = px - 16 * s;
            const wy = py - 16 * s;
            ctx.font = `${Math.max(10, 12 * s)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(icons[city.weather] ?? '🌤️', wx, wy);
            // 악천후 경고 링 (수확 페널티 도시)
            if (city.harvestModifier !== undefined && city.harvestModifier < 0.8) {
                ctx.strokeStyle = 'rgba(224, 122, 106, 0.85)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(px, py, 15 * s, 0, Math.PI * 2);
                ctx.stroke();
            }
        }
        ctx.textAlign = 'start';
        ctx.textBaseline = 'alphabetic';
    }

    /** 지도 날씨 오버레이 표시 토글 [321-340] (기본 on) */
    setShowWeatherOverlay(show: boolean): void {
        this.showWeatherOverlay = show;
    }

    /**
     * [1057][321-340] 계절 톤 설정 — 대륙/바다 색조를 계절에 맞게 보정.
     * @param season 'spring'|'summer'|'autumn'|'winter' 또는 null(보정 해제)
     */
    setSeasonTint(season: 'spring' | 'summer' | 'autumn' | 'winter' | null): void {
        this.seasonTint = season;
    }

    private static readonly SEASON_TINTS: Record<'spring' | 'summer' | 'autumn' | 'winter', Array<[number, string]>> = {
        spring: [[0, 'rgba(140, 200, 120, 0.18)'], [1, 'rgba(140, 200, 120, 0.10)']],
        summer: [[0, 'rgba(90, 180, 90, 0.22)'], [1, 'rgba(60, 150, 70, 0.12)']],
        autumn: [[0, 'rgba(220, 150, 60, 0.20)'], [1, 'rgba(180, 110, 40, 0.10)']],
        winter: [[0, 'rgba(200, 220, 245, 0.22)'], [1, 'rgba(150, 180, 220, 0.12)']],
    };

    /** 비트맵 위 계절 보정 — 육지색 없이 반투명 톤만 얹는다. 스케치 경로와 그라데이션을 공유하면 지도가 가려진다. */
    private seasonTintOverlay(width: number, height: number): CanvasGradient | null {
        if (!this.seasonTint) return null;
        const grad = this.ctx.createLinearGradient(0, 0, width, height);
        for (const [stop, color] of ChinaMapRenderer.SEASON_TINTS[this.seasonTint]) {
            grad.addColorStop(stop, color);
        }
        return grad;
    }

    /** 계절별 대륙 색 보정 — 태평성세/설한/황염의 계절감 표현 */
    private applySeasonTint(grad: CanvasGradient): CanvasGradient {
        if (!this.seasonTint) return grad;
        for (const [stop, color] of ChinaMapRenderer.SEASON_TINTS[this.seasonTint]) {
            grad.addColorStop(stop, color);
        }
        return grad;
    }

    /** [49] 미발견 도시의 흐림·실루엣 표현 — 소유 색/병력/날씨는 숨긴다. */
    private drawUndiscoveredCity(ctx: CanvasRenderingContext2D, city: MapCityView, width: number, height: number): void {
        const { px, py } = this.cityMapToPixel(city, width, height);
        const s = this.zoom;
        const margin = 60 * s;
        if (px < -margin || px > width + margin || py < -margin || py > height + margin) return;

        const w = 22 * s;
        const h = 14 * s;
        ctx.save();
        ctx.strokeStyle = 'rgba(220, 220, 220, 0.42)';
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = Math.max(1, 1.2 * s);
        ctx.setLineDash([4 * s, 3 * s]);
        ctx.beginPath();
        ctx.arc(px, py, 20 * s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = 0.38;
        ctx.filter = 'grayscale(1) blur(0.7px)';
        ctx.fillStyle = '#8a8a8e';
        ctx.strokeStyle = 'rgba(20, 20, 24, 0.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(px - w / 2, py - h / 2 + 3 * s, w, h - 3 * s);
        ctx.fill();
        ctx.stroke();
        for (const m of [-0.35, 0, 0.35]) {
            ctx.beginPath();
            ctx.rect(px + m * w - 2.5 * s, py - h / 2 - 2 * s, 5 * s, 5 * s);
            ctx.fill();
            ctx.stroke();
        }
        ctx.fillStyle = '#6d6d72';
        ctx.beginPath();
        ctx.arc(px, py - h / 2 - 6 * s, 4.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.font = `bold ${Math.max(10, 12 * s)}px "Malgun Gothic", sans-serif`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.strokeText(city.name, px, py - h / 2 - 14 * s);
        ctx.fillStyle = '#b0b0b4';
        ctx.fillText(city.name, px, py - h / 2 - 14 * s);
        ctx.restore();
    }

    private drawCity(ctx: CanvasRenderingContext2D, city: MapCityView, width: number, height: number): void {
        if (city.isDiscovered === false) {
            this.drawUndiscoveredCity(ctx, city, width, height);
            return;
        }
        const { px, py } = this.cityMapToPixel(city, width, height);
        const s = this.zoom;
        const margin = 60 * s;
        if (px < -margin || px > width + margin || py < -margin || py > height + margin) return;

        const hovered = this.hoveredCityId === city.id;
        const selected = city.isSelected;

        // [49] 도시 구분선 — 도시 영향 범위를 나타내는 가는 원형 경계다.
        // 방문하지 않은 인접 도시는 점선으로 표시해 실루엣과 구분한다.
        ctx.save();
        ctx.strokeStyle = this.lightenColor(city.ownerColor || '#888888', 0.25);
        ctx.globalAlpha = 0.58;
        ctx.lineWidth = Math.max(1, 1.2 * s);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(px, py, 20 * s, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // 도시 반경 글로우 (플레이어/호버 강조)
        if (city.isPlayer || selected || hovered) {
            const glowR = (selected ? 22 : hovered ? 18 : 16) * s;
            const glow = ctx.createRadialGradient(px, py, 0, px, py, glowR);
            glow.addColorStop(0, city.isPlayer ? 'rgba(240, 217, 140, 0.5)' : 'rgba(255,255,255,0.35)');
            glow.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(px, py, glowR, 0, Math.PI * 2);
            ctx.fill();
        }

        // 성(城) 아이콘 — 성벽 3개 돌기
        const w = 22 * s;
        const h = 14 * s;
        ctx.fillStyle = selected || hovered ? '#f0d98c' : '#c8b070';
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        // 성벽 몸체 + 3개 돌기
        ctx.rect(px - w / 2, py - h / 2 + 3 * s, w, h - 3 * s);
        ctx.fill();
        ctx.stroke();
        const merlons = [-0.35, 0, 0.35];
        for (const m of merlons) {
            ctx.rect(px + m * w - 2.5 * s, py - h / 2 - 2 * s, 5 * s, 5 * s);
            ctx.fill();
            ctx.stroke();
        }

        // 소속기 색 배지 (성 위)
        ctx.fillStyle = city.ownerColor;
        ctx.beginPath();
        ctx.arc(px, py - h / 2 - 6 * s, 4.5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // 병력 배지 (성 아래)
        const garrisonText = `${Math.round(city.garrison / 100) / 10}만`;
        ctx.font = `bold ${Math.max(8, 9 * s)}px "Malgun Gothic", sans-serif`;
        ctx.textAlign = 'center';
        const tw = ctx.measureText(garrisonText).width + 8 * s;
        ctx.fillStyle = 'rgba(10, 12, 24, 0.75)';
        ctx.fillRect(px - tw / 2, py + h / 2 + 2 * s, tw, 12 * s);
        ctx.fillStyle = '#d8d8e8';
        ctx.fillText(garrisonText, px, py + h / 2 + 11 * s);

        // 도시 이름
        ctx.fillStyle = selected ? '#ffff88' : '#f0e8d0';
        ctx.font = `bold ${Math.max(10, 12 * s)}px "Malgun Gothic", sans-serif`;
        ctx.strokeStyle = 'rgba(0,0,0,0.8)';
        ctx.lineWidth = 3;
        ctx.strokeText(city.name, px, py - h / 2 - 14 * s);
        ctx.fillText(city.name, px, py - h / 2 - 14 * s);
    }

    pan(dx: number, dy: number): void {
        this.offsetX += dx;
        this.offsetY += dy;
    }

    zoomAt(factor: number, centerPx: number, centerPy: number): void {
        // 커서 위치의 정규 좌표를 보존하며 줌
        const before = this.screenToNorm(centerPx, centerPy);
        this.zoom = Math.max(0.6, Math.min(2.5, this.zoom * factor));
        const after = this.screenToNorm(centerPx, centerPy);
        this.offsetX += (after.x - before.x) * this.baseScale();
        this.offsetY += (after.y - before.y) * this.baseScale();
    }

    private baseScale(): number {
        const width = this.canvas.width;
        const height = this.canvas.height;
        return Math.min(width / 1.0, height / 0.92) * 0.96 * this.zoom;
    }

    /** 테스트/디버그용: 현재 지도에 표시되는 세력 라벨 목록 */
    getFactionLabels(): Array<{ name: string; color: string; cells: number; isPlayer: boolean }> {
        if (this.territoryDirty) this.rebuildTerritory();
        return this.factionLabels.map(label => ({ ...label }));
    }

    /** 테스트/디버그용: 현재 영토 셀 통계 */
    getTerritoryStats(): { total: number; colored: number } {
        if (this.territoryDirty) this.rebuildTerritory();
        let colored = 0;
        for (const cell of this.territoryCells) {
            if (cell.ownerColor) colored++;
        }
        return { total: this.territoryCells.length, colored };
    }

    getState(): ChinaMapView {
        return { offsetX: this.offsetX, offsetY: this.offsetY, zoom: this.zoom };
    }
}
