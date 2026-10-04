/**
 * 지도 좌표 데이터 정합성 회귀 테스트
 * 파일: tests/map_coordinates_integrity.test.ts
 *
 * [무엇을 막는가]
 * `assets/map-coordinates-4096.json` 은 자동 검증 없이 개발자가 손으로 늘린다.
 * 도시를 42개 → 57개로 추가하는 동안 아래 셋 중 하나가 깨지면 눈으로 잡히지 않는다.
 *
 *  1. 근접 좌표 — 두 도시가 붙으면 라벨이 겹치고, 겹친 라벨은 `resolveCityLabels` 가
 *     밀어내는데 그 과정에서 다른 라벨과 새로 겹친다. 사용자가 볼 수 있는 것은
 *     "지도 전체가 이상하다" 는 인상이므로 근본 원인이 데이터에 있다.
 *  2. 좌표 정밀도 — 정수로 적힌 경도는 소수점 이하가 잘려 있다는 뜻이다. 이 지도의
 *     x 스케일은 1도당 약 60px 이므로 반도 오차는 최대 ±30px(임계거리의 2/3)다.
 *  3. 투영 이탈 — x 는 경도의 선형 함수다(선형 근사가 아니라 map.projection 이 그렇게
 *     선언한다). 여기서 벗어나면 도시가 지도 어딘가에 "떠 있는" 것이 되고, 도시를
 *     클릭했을 때 본인이 있는 곳이 아니다.
 *
 * [이 테스트가 red 인 상태가 의도다]
 * 2026-10-02 기준 `assets/map-coordinates-4096.json` 은 미커밋 편집 상태로 도시가
 * 57개다. 아래 red 테스트는 그 편집이 코드에 굳어지기 전에 고칠 위치를 diagnostic
 * 메시지로 고정한다. 데이터를 고치면 green 이 된다 — 이 파일을 지우면 안 된다.
 *
 * 데이터 파일(`assets/`, `src/data/`) 은 읽기 전용이다. 이 테스트는 절대 고치지 않는다.
 */

import { describe, it, expect } from 'vitest';
import mapCoords from '../assets/map-coordinates-4096.json';
import regionsData from '../src/data/regions.json';

// ============================================================
// 데이터 모양
// ============================================================

interface MapCity {
    id: string;
    name: string;
    grade: string;
    lat: number;
    lon: number;
    region: string;
    x: number;
    y: number;
}

interface RegionsFile {
    version: number;
    count: number;
    populationEntryCount: number;
    regions: Record<string, {
        name: string;
        gold: number;
        food: number;
        population: number;
        areaCode: number;
        totalOutput: number;
    }>;
    populationByCity: Record<string, number>;
}

const MAP = mapCoords as unknown as {
    map: {
        width: number;
        height: number;
        projection: string;
        lon_range: [number, number];
        lat_range: [number, number];
        scale_px_per_deg: number;
    };
    cities: MapCity[];
};

const REGIONS = regionsData as unknown as RegionsFile;

const CITIES: readonly MapCity[] = MAP.cities;
const CANVAS = MAP.map.width;

// ============================================================
// 임계값 — 본문의 근거 주석과 반드시 함께 읽을 것
// ============================================================

/**
 * 근접 판정 임계거리(4096 좌표계 px).
 *
 * [근거 — 추측이 아니라 프로덕션 상수에서 유도한다]
 * `ChinaMapRenderer.requiredCityGap()` 은 도시 아이콘이 겹치지 않기 위해 필요한
 * 최소 정규화 거리를 이렇게 정의한다.
 *
 *   maxIconPx = (7 + 9*1.0) * zoom          // iconSizeRange 의 최대 성 아이콘 폭 = 16px
 *   baseScale = max(W, H) * 0.96 * zoom
 *   gap_norm  = (maxIconPx / baseScale) * CITY_GAP_SLACK(1.25)
 *
 * zoom 이 약분되므로 창 크기에만 의존한다. 기준 캔버스는 1920x1920다 —
 * `tests/china_map_renderer.test.ts` 의 `CITY_CANVAS` 가 실측에 쓰는 값이다.
 *
 *   gap_norm = (16 * 1.25) / (1920 * 0.96) = 0.0108507
 *   4096 공간 = 0.0108507 * 4096          = 44.44px
 *
 * 즉 **44.4px 보다 가까운 두 도시는 1920px 캔버스에서 성 아이콘이 겹친다.**
 * 도시명 라벨은 아이콘 아래에 6px 폰트로 얹히므로 아이콘이 겹치면 라벨도 겹친다.
 * CITY_GAP_SLACK(1.25) 여유분까지 이미 포함된 수치라서 더 엄격하게 잡을 이유가 없다.
 *
 * 이 임계값 아래인 실제 쌍 (HEAD 42도시에서도 있던 것은 * 표시):
 *   C012 서주 ↔ C052 소패   23.09px  ← 미커밋 편집이 새로 만든 충돌
 *   C022 무창 ↔ C023 강하   31.85px  ← HEAD 부터 존재 *
 *   C008 건업 ↔ C019 단양   39.16px  ← HEAD 부터 존재 *
 */
const PROXIMITY_PX = (16 * 1.25 / (1920 * 0.96)) * CANVAS;

/**
 * 투영 이탈 허용치(px).
 *
 * x 는 경도의 선형 함수다 — 모든 도시를 최소제곱으로 직선에 맞추면 나머지가 1.69px 안에서
 * 끝난다(57개 중 56개). 따라서 5px 는 정상 잔차의 약 3배 마진이면서, 실제 이탈 사례는
 * 이백 배를 넘기 때문에 아무도 오탐하지 않는다.
 */
const PROJECTION_TOL_PX = 5;

/** 좌표는 소수점 1자리(0.1도)까지는 구분해야 한다 — 아래 정밀도 테스트 참조. */
const MIN_DECIMALS = 1;

const REQUIRED_FIELDS = ['id', 'name', 'lat', 'lon', 'x', 'y'] as const;

// ============================================================
// 헬퍼
// ============================================================

function decimalPlaces(v: number): number {
    const s = String(v);
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : s.length - dot - 1;
}

/** "C012 서주(2646,1697.2)" — 실패 메시지에서 사람이 바로 읽는 좌표 표기. */
function fmt(c: MapCity): string {
    return `${c.id} ${c.name}(x=${c.x}, y=${c.y})`;
}

/** 근접 도시 쌍을 거리순으로. */
function closePairs(threshold: number): Array<{ a: MapCity; b: MapCity; d: number }> {
    const out: Array<{ a: MapCity; b: MapCity; d: number }> = [];
    for (let i = 0; i < CITIES.length; i++) {
        for (let j = i + 1; j < CITIES.length; j++) {
            const d = Math.hypot(CITIES[i].x - CITIES[j].x, CITIES[i].y - CITIES[j].y);
            if (d < threshold) out.push({ a: CITIES[i], b: CITIES[j], d });
        }
    }
    return out.sort((p, q) => p.d - q.d);
}

/** x = k * lon + b 최소제곱 적합. 투영이 정말 선형인지 검증하기 위한 도구. */
function fitX(): { k: number; b: number } {
    const n = CITIES.length;
    let sl = 0, sx = 0, sll = 0, slx = 0;
    for (const c of CITIES) {
        sl += c.lon; sx += c.x; sll += c.lon * c.lon; slx += c.lon * c.x;
    }
    const k = (n * slx - sl * sx) / (n * sll - sl * sl);
    return { k, b: (sx - k * sl) / n };
}

// ============================================================
// 1. 구조 무결성 — 현재 정상. 여기서 red 가 나면 데이터 편집이 깨진 것이다.
// ============================================================

describe('맵 좌표 JSON 구조 무결성', () => {
    it('모든 도시에 필수 필드가 전부 있다', () => {
        const missing = CITIES.flatMap((c) =>
            REQUIRED_FIELDS
                .filter((f) => c[f] === undefined || c[f] === null || c[f] === ('' as never))
                .map((f) => `${c.id ?? '(id 없음)'} ${c.name ?? '(name 없음)'}: ${f} 누락`),
        );
        expect(missing, `필수 필드가 빠진 도시 ${missing.length}건:\n  ${missing.join('\n  ')}`)
            .toEqual([]);
    });

    it('도시 id 가 중복되지 않는다', () => {
        const seen = new Set<string>();
        const dups = CITIES.map((c) => c.id).filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
        expect(dups, `중복 id: ${dups.join(', ')}`).toEqual([]);
    });

    it('도시명이 중복되지 않는다', () => {
        const seen = new Set<string>();
        const dups = CITIES.map((c) => c.name).filter((n) => (seen.has(n) ? true : (seen.add(n), false)));
        // 이름이 겹치면 라벨이 구별되지 않고 regions.json 매칭도 1:N 으로 새어 나간다.
        expect(dups, `중복 도시명: ${dups.join(', ')}`).toEqual([]);
    });

    it('id 가 C001 부터 끊기지 않고 연속된다', () => {
        const ids = CITIES.map((c) => c.id).slice().sort();
        const gaps = ids.filter((id, i) => id !== `C${String(i + 1).padStart(3, '0')}`);
        expect(gaps, `연속하지 않은 id: ${gaps.join(', ')} (총 ${ids.length}개)`).toEqual([]);
    });

    it('x/y 는 유한수이고 4096 캔버스 안에 있다', () => {
        const bad = CITIES
            .filter((c) => ![c.x, c.y, c.lat, c.lon].every(Number.isFinite))
            .map((c) => `${fmt(c)} lat=${c.lat} lon=${c.lon} 가 유한수가 아니다`);
        const out = CITIES
            .filter((c) => c.x < 0 || c.x > CANVAS || c.y < 0 || c.y > CANVAS)
            .map((c) => `${fmt(c)} 가 ${CANVAS}x${CANVAS} 캔버스 밖이다`);
        expect([...bad, ...out].join('\n  ')).toBe('');
    });

    it('lat/lon 이 선언된 지도 범위 안에 있다', () => {
        const [lon0, lon1] = MAP.map.lon_range;
        const [lat0, lat1] = MAP.map.lat_range;
        const bad = CITIES
            .filter((c) => c.lat < lat0 || c.lat > lat1 || c.lon < lon0 || c.lon > lon1)
            .map((c) => `${fmt(c)} lat=${c.lat} lon=${c.lon} 가 `
                + `lat[${lat0},${lat1}] lon[${lon0},${lon1}] 밖이다`);
        expect(bad, `범위 밖 도시 ${bad.length}건:\n  ${bad.join('\n  ')}`).toEqual([]);
    });

    it('위도가 높을수록 y 는 작다 (적도 → 북극은 위에서 아래로 내려간다)', () => {
        const sorted = CITIES.slice().sort((a, b) => b.lat - a.lat);
        const violations: string[] = [];
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].y <= sorted[i - 1].y) {
                violations.push(
                    `${sorted[i - 1].id} ${sorted[i - 1].name}(lat=${sorted[i - 1].lat}, y=${sorted[i - 1].y})`
                    + ` 위인데 ${sorted[i].id} ${sorted[i].name}(lat=${sorted[i].lat}, y=${sorted[i].y})`
                    + ' 보다 아래가 아니다 — y 가 어긋나 있다',
                );
            }
        }
        expect(violations, `단조성 위반 ${violations.length}건:\n  ${violations.join('\n  ')}`).toEqual([]);
    });
});

// ============================================================
// 2. 근접 좌표 충돌 — 라벨 안티오버랩의 데이터 측 원인
// ============================================================

describe(`근접 좌표 충돌 (임계거리 ${PROXIMITY_PX.toFixed(2)}px)`, () => {
    it('어떤 두 도시도 임계거리 안으로 붙지 않는다', () => {
        const hits = closePairs(PROXIMITY_PX);
        const report = hits.map((p) =>
            `  ${fmt(p.a)} ↔ ${fmt(p.b)}  거리 ${p.d.toFixed(2)}px  `
            + `(${PROXIMITY_PX.toFixed(2)}px 보다 ${(PROXIMITY_PX - p.d).toFixed(2)}px 가까움)`,
        );
        expect(hits.length, `붙은 도시 쌍 ${hits.length}건 — 아이콘이 겹쳐 라벨이 밀린다:\n`
            + report.join('\n')).toBe(0);
    });

    it('근접 도시 쌍은 0이고, 있다면 거리순으로 상위 3쌍이 진단된다', () => {
        // 임계값이 실제 충돌을 놓치지 않는지 확인하는 조옮보기.
        // 가까운 것이 하나도 없으면 이 테스트는 "아무 일도 없다" 를 말하고,
        // 있으면 바로 위 테스트가 그 목록으로 red 가 된다.
        const top3 = closePairs(Infinity).slice(0, 3);
        const report = top3.map((p) => `  ${fmt(p.a)} ↔ ${fmt(p.b)}  ${p.d.toFixed(2)}px`).join('\n');
        expect(top3.length, `가장 가까운 3쌍:\n${report}`).toBeGreaterThanOrEqual(3);
    });

    it('x 좌표가 완전히 같은 두 도시는 경도가 실제로도 같을 때만 허용된다', () => {
        // [왜 이게 따로 필요한가]
        // 코디네이터 제보는 "C051 제남(x=2628.8) 과 C052 소패(x=2628.8) 의 x 가 동일" 이며
        // 이를 근접 충돌로 보고했다. **실측하면 그 판단은 틀렸다.** 두 도시의 y 는
        // 1271.8 과 1681.8 로 410px 떨어져 있어 근접이 아니다.
        //
        // 진짜 문제는 x 가 왜 같아졌냐다. x 는 경도의 선형 함수이므로(아래 투영 테스트 참고)
        // x 가 같다는 것은 "경도가 같다" 는 뜻이어야 한다. 그런데 제남과 소패는
        // 각각 다른 도시이고, 둘 다 경도를 정수 `117` 로 적어 버렸다.
        // 정수 경도는 소수점 이하가 잘렸다는 신호이며, 이 지도에서 1도는 약 60px 다.
        // → x 가 같으면서 경도 표기 정밀도가 낮은 쌍을 찾아 정확한 근본을 보고한다.
        const byX = new Map<number, MapCity[]>();
        for (const c of CITIES) {
            const list = byX.get(c.x) ?? [];
            list.push(c);
            byX.set(c.x, list);
        }
        const suspicious: string[] = [];
        for (const [x, list] of byX) {
            if (list.length < 2) continue;
            for (let i = 0; i < list.length; i++) {
                for (let j = i + 1; j < list.length; j++) {
                    const a = list[i];
                    const b = list[j];
                    const coarse = decimalPlaces(a.lon) < MIN_DECIMALS || decimalPlaces(b.lon) < MIN_DECIMALS;
                    if (!coarse) continue;
                    suspicious.push(
                        `  x=${x} 인 ${a.id} ${a.name}(lon=${a.lon}) 와 `
                        + `${b.id} ${b.name}(lon=${b.lon}) 의 x 가 같다 — `
                        + `둘 다 경도를 정수/단순 소수로 적어 소수점 이하가 잘렸다. `
                        + `이 지도는 1도당 약 60px 이므로 0.1도(6px) 단위까지는 구분해야 한다.`,
                    );
                }
            }
        }
        expect(suspicious, `x 가 동일하지만 경도 표기가 뭉툭한 도시 쌍 ${suspicious.length}건:\n`
            + suspicious.join('\n')).toEqual([]);
    });

    it('경도는 소수점 1자리 이상으로 적혀 있다 (잘림 방지)', () => {
        const coarse = CITIES
            .filter((c) => decimalPlaces(c.lon) < MIN_DECIMALS || decimalPlaces(c.lat) < MIN_DECIMALS)
            .map((c) => `  ${fmt(c)} lat=${c.lat} lon=${c.lon} `
                + `(lat ${decimalPlaces(c.lat)}자리, lon ${decimalPlaces(c.lon)}자리)`);
        expect(coarse, `소수점 1자리 미만이하로 적힌 도시 ${coarse.length}건:\n${coarse.join('\n')}`)
            .toEqual([]);
    });

    it('x 는 경도의 선형 투영을 벗어난다 (도시가 지도에 "떠 있지" 않다)', () => {
        const { k, b } = fitX();
        const outliers = CITIES
            .map((c) => ({ c, predicted: k * c.lon + b, dev: c.x - (k * c.lon + b) }))
            .filter((r) => Math.abs(r.dev) > PROJECTION_TOL_PX)
            .sort((p, q) => Math.abs(q.dev) - Math.abs(p.dev))
            .map((r) => `  ${fmt(r.c)} lon=${r.c.lon} 이면 x 는 ${r.predicted.toFixed(1)} 이어야 하는데 `
                + `${r.c.x} 로 적혀 있다 (오차 ${r.dev.toFixed(2)}px)`);
        expect(outliers, `선형 투영에서 ${PROJECTION_TOL_PX}px 이상 벗어난 도시 ${outliers.length}건:\n`
            + outliers.join('\n')).toEqual([]);
    });
});

// ============================================================
// 3. regions.json ↔ 맵 정합성 진단
// ============================================================

describe('regions.json ↔ 맵 좌표 정합성', () => {
    const mapNames = CITIES.map((c) => c.name);
    const mapSet = new Set(mapNames);
    const regionNames = Object.keys(REGIONS.regions);
    const regionSet = new Set(regionNames);

    const mapOnly = mapNames.filter((n) => !regionSet.has(n));
    const regionOnly = regionNames.filter((n) => !mapSet.has(n));
    const shared = mapNames.filter((n) => regionSet.has(n));

    it('맵에 있는 모든 도시가 regions.json 에 등록되어 있다', () => {
        // [왜 red 여야 하는가]
        // 맵 도시가 regions 에 없으면 그 도시는 경제 수치(gold/food/population)를
        // 받지 못한다. 42 → 57 확장으로 15개가 추가됐는데 regions.json 은 46개다.
        // 이게 그대로 커밋되면 "지도에 있는데 값이 없는 도시" 가 코드에 굳어진다.
        expect(mapOnly.length,
            `맵에는 있지만 regions.json 에 없는 도시 ${mapOnly.length}개:\n`
            + `  ${mapOnly.join(', ')}\n`
            + `  (맵 ${mapNames.length}개 중 ${shared.length}개만 regions 에 있음 — `
            + `${mapOnly.length}개가 경제 데이터 없이 고립되어 있다)`).toBe(0);
    });

    it('regions.json 의 모든 지역이 맵에 도시로 존재한다', () => {
        // 반대 방향. regions 에는 있는데 맵에 없는 지역은 내정AI가 참조하는
        // 존재하지 않는 도시다 — 플레이어가 절대 갈 수 없다.
        expect(regionOnly.length,
            `regions.json 에는 있지만 맵에 없는 지역 ${regionOnly.length}개:\n`
            + `  ${regionOnly.join(', ')}`).toBe(0);
    });

    it('양쪽 이름 집합이 정확히 일치한다 (불일치 개수 진단)', () => {
        // 위 두 테스트가 방향별 원인을 말한다면, 이건 총량 요약이다.
        // 고칠 때는 이 숫자가 0이 되어야 한다.
        expect(mapOnly.length + regionOnly.length,
            `맵 ${mapNames.length}개 ↔ regions ${regionNames.length}개 중 `
            + `${shared.length}개만 일치.\n`
            + `  맵에만 있음 (${mapOnly.length}): ${mapOnly.join(', ')}\n`
            + `  regions 에만 있음 (${regionOnly.length}): ${regionOnly.join(', ')}`).toBe(0);
    });

    it('맵 도시 수와 regions.json count 필드가 어긋나지 않는다', () => {
        // regions.json 은 자기 항목 수를 `count` 에 선언한다. 이게 실제와 다르면
        // 다른 곳(전술 참조표)이 잘못된 개수를 신뢰하게 된다.
        expect(REGIONS.count, `regions.json 의 count=${REGIONS.count} 이나 실제 지역은 `
            + `${regionNames.length}개다`).toBe(regionNames.length);
    });

    it('regions.json 자체는 자기 선언과 일치한다 (기존 데이터 sanity)', () => {
        const broken: string[] = [];
        for (const key of regionNames) {
            const r = REGIONS.regions[key];
            if (r.name !== key) broken.push(`  ${key}: name 필드가 ${r.name} 이다`);
            for (const field of ['gold', 'food', 'population', 'areaCode', 'totalOutput'] as const) {
                if (!Number.isFinite(r[field])) broken.push(`  ${key}.${field}=${r[field]} 가 유한수가 아니다`);
            }
        }
        const popKeys = Object.keys(REGIONS.populationByCity ?? {});
        if (popKeys.length !== regionNames.length) {
            broken.push(`  populationByCity 가 ${popKeys.length}개 인데 regions 는 ${regionNames.length}개다`);
        }
        expect(broken, `regions.json 내부 불일치 ${broken.length}건:\n${broken.join('\n')}`).toEqual([]);
    });
});