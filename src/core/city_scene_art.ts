/**
 * 도시 진입 화면 배경 그림 — 표본(bake) 위치와 라벨 앵커.
 *
 * [왜 앵커 표가 필요한가]
 * 배경은 회사가 그린 그림이라 코드의 등각 격자 좌표와 어긋난다. 라벨 배지를
 * 기존처럼 타원 링에 두면 그림 위에서 아무 데나 떠 있게 되어 "어느 건물의 라벨인지"
 * 알 수 없게 된다. 그래서 그림을 보고 손으로 정한 앵커를 건물 타입마다 하나씩
 * 둔다 — 배지와 그림이 같은 자리를 가리키게 하는 것이 목적이다.
 *
 * 좌표는 **캔버스 기준 %** 다. 배경은 16:9 이고 캔버스는 2:1 이라 cover 로
 * 맞추면서 위아래가 잘린다. 앵커는 그 잘림을 고려해 넣은 값이다.
 */
import type { CityBuildingType } from './city_3d_renderer';

/** 배경 그림 경로. sw-precache 생성 대상이라 assets/ 아래에 둔다. */
export const CITY_SCENE_ART_PATH = 'assets/city-scene-base.png';

/** 앵커 단위 — 캔버스 가로/세로 기준 %. */
export interface SceneAnchor {
    readonly x: number;
    readonly y: number;
}

/**
 * 건물 타입 → 그림 위 라벨 위치.
 *
 * 배경 그림(16:9) 기준 추정치를 2:1 캔버스로 옮긴 값이다.
 * 그림을 다시 만들면 여백만 조정하면 되고, 좌표는 여기 한 곳에만 있다.
 */
export const CITY_SCENE_ART_ANCHORS: Record<CityBuildingType, SceneAnchor> = {
    // 상단 고지대 궁성 — 도장
    GOVERNMENT: { x: 38, y: 11 },
    // 우측 성문
    WALL: { x: 72, y: 24 },
    // 좌측 둔영
    BARRACKS: { x: 13, y: 44 },
    // 중앙 시장
    MARKET: { x: 47, y: 47 },
    // 중앙 사원
    TEMPLE: { x: 30, y: 33 },
    // 하단 공방
    WORKSHOP: { x: 45, y: 79 },
    // 하단 좌측 농촌
    FARM: { x: 17, y: 79 },
    // 우측 준점·자택
    HOUSE: { x: 86, y: 50 },
};

export interface CoverPlacement {
    /** 원본에서 잘라낼 좌표(소수 가능). */
    readonly sx: number;
    readonly sy: number;
    readonly sw: number;
    readonly sh: number;
    /** 실제 그려지는 표시 배율. */
    readonly scale: number;
}

/**
 * object-fit: cover 와 같은 결과를 정수 연산으로 낸다.
 *
 * [왜 직접 계산하나]
 * 브라우저에는 object-fit 이 있지만 이 계산은 캔버스 drawImage 에 쓰인다.
 * 캔버스는 object-fit 가 없으므로 같은 수식을 그대로 옮겨야 어떤 렌더러에서도
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
    return {
        sx: (srcWidth - sw) / 2,
        sy: (srcHeight - sh) / 2,
        sw,
        sh,
        scale,
    };
}

/**
 * 앵커가 없는 타입이면 배치를 놓치지 않도록 화면 안쪽 기본점을 준다.
 * 앵커가 정의되지 않은 타입이 늘면 앵커 표를 고쳐야 한다는 신호가 된다.
 */
export function anchorFor(type: CityBuildingType, fallbackIndex = 0, fallbackTotal = 1): SceneAnchor {
    const anchor = CITY_SCENE_ART_ANCHORS[type];
    if (anchor) return anchor;
    const angle = -Math.PI / 2 + (fallbackIndex * Math.PI * 2) / Math.max(1, fallbackTotal);
    return { x: 50 + 42 * Math.cos(angle), y: 50 + 36 * Math.sin(angle) };
}
