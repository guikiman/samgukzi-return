/**
 * 증원 시스템 [86/107] — 인접 아군 도시 지원군
 *
 * 공성전이 벌어지는 방어 도시에 대해 인접(직선거리 기준) 아군 도시가
 * 병력·무장을 지원하는 시스템. 플레이어 출진과 AI 공성 양쪽에서 사용한다.
 *
 * [결함 수정] 인접 판정 좌표표를 이 파일에 복사해 두었더니 두 가지가 어긋났다.
 *  1) 게임은 도시 id('city_낙양')로 호출하는데 표의 키는 도시명('낙양')이었다.
 *     → 조회 실패로 항상 false, 증원 기능이 전 시나리오에서 무동작이었다.
 *  2) 좌표 스케일까지 달랐다(여기 pixel 0~800 vs scenario_system 0~1 정규화).
 * 도시 좌표는 scenario_system 의 CITY_MAP_COORDS(전술 좌표) 하나만 쓴다.
 * 스크립트도 도시 id 를 받도록 바꿔 호출부가 이름으로 우연히 동작하는
 * 경우를 막는다.
 */

import type { City, Officer, Army } from './types.js';
import { CITY_MAP_COORDS } from './scenario_system.js';

/** 도시 간 거리 임계값 — 정규화 좌표(0~1) 기준. [결함 수정] */
const ADJACENT_DISTANCE = 0.16;

/** 거리 비교의 부동소수 여유 (0.40 - 0.24 = 0.16000000000000003 같은 오차 대비) */
const DISTANCE_EPSILON = 1e-9;

/**
 * [결함 수정] 도시 id 또는 이름 어느 쪽이든 좌표를 찾는다.
 * 게임은 'city_낙양' 형태의 id 로, 테스트 픽스처는 '낙양' 으로 부른다.
 *
 * 중복 도시명 때문에 scenario_system 이 'city_낙양_3' 처럼 접미사를 붙이는
 * 경우가 있어 접미사도 잘라 낸다. 표에 없으면 undefined 를 돌려주고,
 * 호출부가 조용히 무시한다(오탐 없는 조용한 실패가 조회 실패의 대가다).
 */
function coordOf(key: string): { x: number; y: number } | undefined {
    const direct = CITY_MAP_COORDS[key];
    if (direct) return direct;
    if (!key.startsWith('city_')) return undefined;
    // 'city_낙양_3' → '낙양_3' → '낙양'
    const name = key.slice(5);
    return CITY_MAP_COORDS[name] ?? CITY_MAP_COORDS[name.replace(/_\d+$/, '')];
}

/**
 * 두 도시가 인접한지 (거리 기반)
 *
 * [결함 수정] 임계값 비교에 여유를 둔다. 표에 실린 좌표에는
 * 허창-업처럼 정규화 거리로 딱 0.16 인 쌍이 있고, 0.40 - 0.24 를 빼면
 * 0.16000000000000003 이 나와 `<= 0.16` 이 거짓말을 한다.
 * 좌표는 소수 둘째 자리 근처에서만 나오므로 1e-9 여유는 판정을 뒤집지 않는다.
 */
export function areCitiesAdjacent(cityAId: string, cityBId: string): boolean {
    if (cityAId === cityBId) return false;
    const a = coordOf(cityAId);
    const b = coordOf(cityBId);
    if (!a || !b) return false;
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy) <= ADJACENT_DISTANCE + DISTANCE_EPSILON;
}

/** 방어 도시에 증원 가능한 인접 아군 도시 목록 */
export function getAdjacentFriendlyCities(
    defenseCityId: string,
    ownerId: string,
    cities: City[],
): City[] {
    return cities.filter(
        (c) =>
            c.id !== defenseCityId &&
            c.ownerId === ownerId &&
            areCitiesAdjacent(defenseCityId, c.id),
    );
}

export interface ReinforcementContingent {
    sourceCityId: string;
    troops: number;
    officerIds: string[]; // 지원 파견 무장 ID (도시에 남는 무장은 제외)
}

export interface ReinforcementResult {
    defenseCityId: string;
    totalTroops: number;
    contingents: ReinforcementContingent[];
    officerIds: string[];
}

/**
 * 인접 아군 도시들로부터 지원군을 편성한다.
 *
 * 파견 규칙:
 *  - 각 아군 도시는 보유 병력의 50%를 지원 (최소 200 필요)
 *  - 무장은 최대 2명 파견, 도시에 최소 1명은 남긴다
 *  - 파견 무장은 통솔 높은 순으로 선발
 */
export function assembleReinforcements(
    defenseCityId: string,
    ownerId: string,
    cities: City[],
    officers: Officer[],
    armies: Army[] = [],
): ReinforcementResult {
    const contingents: ReinforcementContingent[] = [];
    let totalTroops = 0;

    const sources = getAdjacentFriendlyCities(defenseCityId, ownerId, cities);

    for (const src of sources) {
        // ① 도시 주둔 병력 우선 (도시 troops 개념이 없어 offcerIds 기반 부대에서 산출)
        // 도시에 주둔하는 부대(armies)의 병력 합산
        const cityArmies = armies.filter(
            (a) => a.originCityId === src.id || a.targetCityId === src.id,
        );
        let troops = cityArmies.reduce((sum, a) => sum + a.soldiers, 0);

        // 부대가 없으면 인구 기반 소규모 지원군 (최소 보충병)
        if (troops === 0) {
            const garrison = officers.filter(
                (o) => o.cityId === src.id && o.factionId === ownerId,
            );
            if (garrison.length === 0) continue;
            troops = Math.floor(src.population * 0.02); // 인구의 2%를 증원병으로
            if (troops < 200) continue; // 최소 증원 규모 미달
        }

        // ② 무장은 통솔 높은 순으로 최대 2명 파견, 도시에 최소 1명은 남긴다
        const stationed = officers
            .filter((o) => o.cityId === src.id && o.factionId === ownerId)
            .sort((a, b) => b.stats.leadership - a.stats.leadership);

        if (stationed.length === 0) continue;

        const dispatchCount = Math.min(2, Math.max(0, stationed.length - 1));
        const dispatched = stationed.slice(0, dispatchCount);

        contingents.push({
            sourceCityId: src.id,
            troops,
            officerIds: dispatched.map((o) => o.id),
        });
        totalTroops += troops;
    }

    return {
        defenseCityId,
        totalTroops,
        contingents,
        officerIds: contingents.flatMap((c) => c.officerIds),
    };
}

/** 도시가 다른 도시와 맞닿아 있는지 (공격 측에서 출진 가능 대상 판정용) */
export function canAttackFrom(
    fromCityId: string,
    toCityId: string,
): boolean {
    return areCitiesAdjacent(fromCityId, toCityId);
}
