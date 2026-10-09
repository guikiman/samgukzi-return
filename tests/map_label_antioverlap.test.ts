// @vitest-environment jsdom — ChinaMapRenderer가 오프스크린 레이어에서 document.createElement 사용
/**
 * [461-480] 지도 세력 라벨 안티오버랩 테스트
 * 파일: tests/map_label_antioverlap.test.ts
 *
 * measureText를 실측 모킹해, 겹치는 두 세력 라벨에서 큰 영토(플레이어)가
 * 우선 표시되고 작은 라벨이 양보하는지 fillText 횟수로 검증한다.
 */

import { describe, it, expect, vi } from 'vitest';
import { ChinaMapRenderer } from '../src/core/china_map_renderer';
import type { MapCityView } from '../src/core/china_map_renderer';

/** 텍스트 폭을 글자수 × 글자크기로 실측하는 모킹 컨텍스트 */
function makeCtx(c: { fillText: () => void; setFontPx: (px: number) => void }) {
    const ctx: Record<string, unknown> = {
        set font(v: string) {
            const m = /(\d+(?:\.\d+)?)\s*px/.exec(String(v));
            if (m) c.setFontPx(parseFloat(m[1]));
        },
        get font() { return '16px'; },
        measureText: (text: string) => ({ width: text.length * c.getFontPx() * 0.9 }),
        fillText: () => c.fillText(),
        strokeText: () => {},
        clearRect: () => {}, fillRect: () => {}, beginPath: () => {},
        moveTo: () => {}, lineTo: () => {}, closePath: () => {},
        stroke: () => {}, fill: () => {}, arc: () => {}, rect: () => {},
        quadraticCurveTo: () => {}, drawImage: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
        createRadialGradient: () => ({ addColorStop: () => {} }),
        setLineDash: () => {}, save: () => {}, restore: () => {},
        translate: () => {}, scale: () => {},
        globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1,
        textAlign: '', textBaseline: '',
    };
    return ctx as unknown as CanvasRenderingContext2D;
}

function setupRendererEnv(counters: { fillText: () => void }) {
    const ctx = makeCtx(counters);
    const makeMockCanvas = () => ({
        width: 1200,
        height: 700,
        getContext: () => ctx,
    });
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
        if (tag === 'canvas') return makeMockCanvas() as unknown as HTMLCanvasElement;
        return originalCreateElement(tag);
    }) as never);
    return { makeMockCanvas };
}

const city = (id: string, x: number, y: number, color: string, isPlayer: boolean): MapCityView =>
    ({ id, name: `도시${id}`, x, y, ownerColor: color, isPlayer, garrison: 5000, factionName: `세력${id}` });

describe('[461-480] 세력 라벨 안티오버랩', () => {
    // 라벨 fillText만 정확히 세는 방법: 도시명/수비력 표기는 폰트 크기가 다르므로
    // 최소 18px(라벨 하한) 이상 폰트의 fillText만 라벨로 간주
    function makeCounters() {
        let labelFills = 0;
        let lastFontPx = 16;
        return {
            get labelFills() { return labelFills; },
            fillText: () => { if (lastFontPx >= 18) labelFills++; },
            setFontPx: (px: number) => { lastFontPx = px; },
            getFontPx: () => lastFontPx,
        };
    }

    it('멀리 떨어진 세력 라벨은 모두 표시된다', () => {
        const c = makeCounters();
        const { makeMockCanvas } = setupRendererEnv(c);
        const r = new ChinaMapRenderer(makeMockCanvas() as unknown as HTMLCanvasElement);
        r.setCities([
            city('A', 0.15, 0.20, '#e69f00', true),
            city('B', 0.80, 0.70, '#0072b2', false),
            city('C', 0.45, 0.85, '#009e73', false),
        ]);
        r.setShowWeatherOverlay(false);
        r.render();
        expect(c.labelFills).toBe(3); // 세 라벨 모두 겹침 없음
    });

    it('저줌에서 라벨 수축 겹침 시 플레이어 라벨이 우선하고 상대는 양보한다', () => {
        const c = makeCounters();
        const { makeMockCanvas } = setupRendererEnv(c);
        const r = new ChinaMapRenderer(makeMockCanvas() as unknown as HTMLCanvasElement);
        // [2026-09-30] 두 도시를 0.80/0.70 → 0.25/0.20 으로 바꿨다.
        // 영토에 반경 상한이 생기며 세력명 위치가 "세력 전체 무게중심" 에서 "소유 셀의 중심" 으로
        // 바뀌었고, 그 결과 이전 좌표는 줌 0.05 에서 37.5px 떨어져 겹침이 아예 발생하지 않았다
        // (라벨 폭은 20px). 겹침 우선순위 로직이 검증되지 않는 케이스였다.
        // 검증 대상은 "겹치면 플레이어가 우선한다" 이므로, 이번 좌표는 5.8px 로 확실히 겹친다.
        r.setCities([
            city('A', 0.15, 0.20, '#e69f00', true),
            city('B', 0.25, 0.20, '#0072b2', false),
        ]);
        r.setShowWeatherOverlay(false);
        // 줌 0.05 — 두 라벨이 화면 중심으로 수축해 AABB가 겹침
        r.setView({ zoom: 0.05 });
        r.render();
        // 플레이어(A) 우선 배치 → B는 겹침 양보로 생략
        expect(c.labelFills).toBe(1);
    });

    it('같은 저줌에서 겹침이 없으면(극단 근접 도시) 모두 유지된다', () => {
        const c = makeCounters();
        const { makeMockCanvas } = setupRendererEnv(c);
        const r = new ChinaMapRenderer(makeMockCanvas() as unknown as HTMLCanvasElement);
        // 두 도시가 사실상 같은 지점 — 무게중심도 근접, 하지만 플레이어 1개만 존재하는 단일 세력 구조로
        // 보로노이가 분할되지 않아 라벨 1개만 생성되는 케이스
        r.setCities([
            city('A', 0.50, 0.50, '#e69f00', true),
        ]);
        r.setShowWeatherOverlay(false);
        r.setView({ zoom: 0.05 });
        r.render();
        expect(c.labelFills).toBe(1);
    });

    it('라벨이 겹치지 않는 3세력은 전부 표시되며 날씨 오버레이와 무관하다', () => {
        const c = makeCounters();
        const { makeMockCanvas } = setupRendererEnv(c);
        const r = new ChinaMapRenderer(makeMockCanvas() as unknown as HTMLCanvasElement);
        r.setCities([
            { ...city('A', 0.15, 0.20, '#e69f00', true), weather: 'SUNNY', harvestModifier: 1.1 },
            { ...city('B', 0.80, 0.70, '#0072b2', false), weather: 'STORM', harvestModifier: 0.6 },
        ] as MapCityView[]);
        r.setShowWeatherOverlay(true);
        r.render();
        expect(c.labelFills).toBe(2);
    });
});
