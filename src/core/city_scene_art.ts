/**
 * 도시 진입 화면 배경 그림 — 경로와 라벨 앵커.
 *
 * [왜 앵커 표가 필요한가]
 * 배경은 회사가 그린 그림이라 코드의 등각 격자 좌표와 어긋난다. 라벨을 종전의
 * 타원 링에 두면 그림 위에서 아무 데나 떠서 "어느 건물의 라벨인지" 알 수 없다.
 * 그래서 건물 타입마다 그림 위 좌표를 하나씩 둔다.
 *
 * 좌표는 **배경 이미지의 %** 다. 이미지가 정확히 16:9 이고, 화면의 무대는 같은
 * 16:9 비율이라 %가 그대로 대응한다 — 창 크기가 달라져도 라벨이 그림에서
 * 밀리지 않는다.
 */
import type { CityBuildingType } from './city_3d_renderer';

/** 배경 그림 경로. WebP(605KB, 원본 PNG 3.3MB). */
export const CITY_SCENE_ART_PATH = 'assets/city-scene-base.webp';

export interface SceneAnchor {
    readonly x: number;
    readonly y: number;
}

/**
 * 건물 타입 → 그림 위 라벨 위치 (%).
 *
 * ⚠ 추정값이다 — 그림을 보고 잡은 좌표라 실제 건물과 어긋날 수 있다.
 * 어긋난 곳을 알려주면 이 표만 고치면 된다. 좌표는 여기 한 곳에만 둔다.
 */
export const CITY_SCENE_ART_ANCHORS: Record<CityBuildingType, SceneAnchor> = {
    GOVERNMENT: { x: 39, y: 15 },  // 궁성 — 상단 고지대
    WALL: { x: 75, y: 27 },        // 성문 — 우측 성벽
    BARRACKS: { x: 12, y: 40 },    // 둔영 — 좌측 연습장
    MARKET: { x: 47, y: 45 },      // 시장 — 중앙
    TEMPLE: { x: 58, y: 30 },      // 사원 — 궁성 아래 홀
    WORKSHOP: { x: 45, y: 75 },    // 공방 — 하단 중앙
    FARM: { x: 13, y: 75 },        // 농촌 — 하단 좌측
    HOUSE: { x: 90, y: 42 },       // 자택 — 우측 끝
};

export interface CoverPlacement {
    readonly sx: number;
    readonly sy: number;
    readonly sw: number;
    readonly sh: number;
    readonly scale: number;
}

/**
 * object-fit: cover 와 같은 결과를 정수 연산으로 낸다.
 * 캔버스 drawImage 에는 object-fit 가 없으므로 같은 수식을 옮겨야 어떤 렌더러에서도
 * 결과가 같아진다.
 */
export function computeCoverPlacement(
    srcWidth: number,
    srcHeight: number,
    destWidth: number,
    destHeight: number,
): CoverPlacement {
    if (srcWidth <= 0 || srcHeight <= 0 || destWidth <= 0 || destHeight <= 0) {
        throw new Error(`computeCoverPlacement: 크기가 0 이하다 (${srcWidth}x${srcHeight} → ${destWidth}x${destHeight})`);
    }
    const scale = Math.max(destWidth / srcWidth, destHeight / srcHeight);
    const sw = destWidth / scale;
    const sh = destHeight / scale;
    return { sx: (srcWidth - sw) / 2, sy: (srcHeight - sh) / 2, sw, sh, scale };
}

/** 앵커가 없는 타입이면 종전 타원 링으로 물러난다 — 배치를 놓치지 않게. */
export function anchorFor(type: CityBuildingType, fallbackIndex = 0, fallbackTotal = 1): SceneAnchor {
    const anchor = CITY_SCENE_ART_ANCHORS[type];
    if (anchor) return anchor;
    const angle = -Math.PI / 2 + (fallbackIndex * Math.PI * 2) / Math.max(1, fallbackTotal);
    return { x: 50 + 42 * Math.cos(angle), y: 50 + 36 * Math.sin(angle) };
}
