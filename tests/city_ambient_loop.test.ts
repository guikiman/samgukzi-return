/**
 * 도시 씬 주야 자동 순환 — 타이머 수명과 재그림 가드, 주야가 그림을 바꾸는지.
 *
 * [배경] 이 로직은 main.ts 안에 있었는데, main.ts 는 최상위에서 DOM 을 만져서
 * 노드에서 import 가 불가능했다. 그래서 "패널을 닫으면 타이머가 멈추는가" 를
 * 자동 검사로 지킬 수 없었고, 실제로 출진 버튼 경로가 stop 을 빠뜨려 0.5초 주기
 * repaint 를 세션 내내 흘리고 있었다. 로직을 core 로 뺀 뒤 여기서 지킨다.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import {
    createAmbientTicker,
    shouldRedrawAmbient,
    CITY_AMBIENT_INTERVAL_MS,
} from '../src/core/city_ambient_loop';
import { City3DRenderer, dayNightPhase, CITY_DAY_NIGHT_PERIOD_MS } from '../src/core/city_3d_renderer';

const REPO_ROOT = resolvePath(__dirname, '..');
const MAIN_TS = readFileSync(resolvePath(REPO_ROOT, 'src/main.ts'), 'utf8');

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('shouldRedrawAmbient', () => {
    const base = { sceneActive: true, cityExists: true, drawnCityId: 'city_a', targetCityId: 'city_a' };

    it('그려진 도시가 감시 대상일 때만 다시 그린다', () => {
        expect(shouldRedrawAmbient(base)).toBe(true);
    });

    it('씬이 닫혔으면 그리지 않는다', () => {
        expect(shouldRedrawAmbient({ ...base, sceneActive: false })).toBe(false);
    });

    it('도시가 사라졌으면 그리지 않는다', () => {
        expect(shouldRedrawAmbient({ ...base, cityExists: false })).toBe(false);
    });

    it('도시를 바꿨으면 이전 도시를 다시 그리지 않는다', () => {
        // 도시 전환 직후 이전 도시가 한 프레임 더 그려지면 깜빡인다.
        expect(shouldRedrawAmbient({ ...base, drawnCityId: 'city_b' })).toBe(false);
        // 아직 아무것도 그려지지 않은 첫 진입도 통과시켜야 한다.
        expect(shouldRedrawAmbient({ ...base, drawnCityId: null })).toBe(false);
    });
});

describe('createAmbientTicker', () => {
    it('주기 간격마다 틱을 부른다', () => {
        const tick = vi.fn();
        createAmbientTicker(CITY_AMBIENT_INTERVAL_MS, tick).start();
        vi.advanceTimersByTime(500 * 4);
        expect(tick).toHaveBeenCalledTimes(4);
    });

    it('stop 하면 더 이상 부르지 않는다 — 닫힌 패널을 계속 그리지 않아야 한다', () => {
        const tick = vi.fn();
        const ticker = createAmbientTicker(CITY_AMBIENT_INTERVAL_MS, tick);
        ticker.start();
        vi.advanceTimersByTime(500 * 2);
        expect(tick).toHaveBeenCalledTimes(2);
        ticker.stop();
        vi.advanceTimersByTime(500 * 100);
        expect(tick).toHaveBeenCalledTimes(2);
    });

    it('start 를 여러 번 불러도 타이머가 하나만 산다', () => {
        // 도시를 열 때마다 중복 repaint 가 쌓이면 프레임이 배수로 느려진다.
        const tick = vi.fn();
        const ticker = createAmbientTicker(CITY_AMBIENT_INTERVAL_MS, tick);
        ticker.start();
        ticker.start();
        ticker.start();
        vi.advanceTimersByTime(500 * 10);
        expect(tick).toHaveBeenCalledTimes(10);
    });

    it('stop 후 start 하면 다시 돈다', () => {
        const tick = vi.fn();
        const ticker = createAmbientTicker(CITY_AMBIENT_INTERVAL_MS, tick);
        ticker.start();
        ticker.stop();
        expect(ticker.running).toBe(false);
        vi.advanceTimersByTime(500 * 3);
        expect(tick).toHaveBeenCalledTimes(0);
        ticker.start();
        expect(ticker.running).toBe(true);
        vi.advanceTimersByTime(500);
        expect(tick).toHaveBeenCalledTimes(1);
    });

    it('stop 을 두 번 불러도 예외가 없다', () => {
        const ticker = createAmbientTicker(CITY_AMBIENT_INTERVAL_MS, vi.fn());
        ticker.start();
        expect(() => { ticker.stop(); ticker.stop(); }).not.toThrow();
    });
});

describe('주야 주기가 실제 그림을 바꾸는가', () => {
    /** 캔버스를 흉내내는 기록용 스텁 — fillStyle 과 fillRect 만 관찰한다. */
    const stubCtx = (): { ctx: CanvasRenderingContext2D; fills: Array<{ style: string; w: number; h: number }> } => {
        const fills: Array<{ style: string; w: number; h: number }> = [];
        const ctx = {
            fillStyle: '',
            canvas: { width: 480, height: 240 },
            fillRect(w: number, h: number) { fills.push({ style: String(this.fillStyle), w, h }); },
        };
        return { ctx: ctx as unknown as CanvasRenderingContext2D, fills };
    };

    it('주간에는 밤 안개를 얹지 않는다', () => {
        const noon = dayNightPhase(CITY_DAY_NIGHT_PERIOD_MS / 2);
        expect(noon.nightFactor).toBeLessThan(0.1);
        const { ctx, fills } = stubCtx();
        new City3DRenderer().applyNightTint(ctx, 480, 240, noon.nightFactor);
        expect(fills).toHaveLength(0);
    });

    it('야간에는 안개가 진해진다 — 한 주기 안에서 다른 장면이 그려진다', () => {
        const renderer = new City3DRenderer();
        const midnight = dayNightPhase(CITY_DAY_NIGHT_PERIOD_MS * 0.9);
        expect(midnight.nightFactor).toBeGreaterThan(0.9);
        const { ctx, fills } = stubCtx();
        renderer.applyNightTint(ctx, 480, 240, midnight.nightFactor);
        expect(fills).toHaveLength(1);
        // 0.42 계수上限 — factor 가 1 을 넘어도 alpha 가 1 이 되지 않는다.
        const alpha = Number(/, ([\d.]+)\)$/.exec(fills[0].style)?.[1]);
        expect(alpha).toBeGreaterThan(0.3);
        expect(alpha).toBeLessThanOrEqual(0.42);
    });

    it('하루 주기를 돌며 안개가 연속해서 변한다 — 틱이 새 값을 읽어 다시 그린다', () => {
        const renderer = new City3DRenderer();
        const alphas: number[] = [];
        // 한 주기를 6등분해 각 시점의 안개 세기를 잰다.
        for (let i = 0; i < 6; i++) {
            const phase = dayNightPhase((CITY_DAY_NIGHT_PERIOD_MS * i) / 6);
            const { ctx, fills } = stubCtx();
            renderer.applyNightTint(ctx, 480, 240, phase.nightFactor);
            alphas.push(fills.length === 0 ? 0 : Number(/, ([\d.]+)\)$/.exec(fills[0].style)![1]));
        }
        // 값이 실제로 변해야 "매 틱 다시 그린다"가 의미를 갖는다.
        expect(new Set(alphas).size).toBeGreaterThan(1);
        expect(Math.max(...alphas)).toBeGreaterThan(0.3);
    });
});

describe('main.ts 배선', () => {
    /**
     * 지점 바로 위 코드 줄 중 `stopCityAmbient();` 호출이 있는지 본다.
     *
     * [주의] 주석 줄은 반드시 제외한다. 실제로 이 검사는 처음에 주석을 걸지
     * 않아서 통과했었다 — 결함을 설명하는 한국어 주석 안에 "stopCityAmbient()"
     * 라는 문자열이 들어 있었고, 그 주석이 검사를 통과시켜 버렸다.
     * 검사가 bug 를 놓친 채 초록으로 빛나던 상태였다.
     */
    const hasStopCallBefore = (index: number): boolean => {
        const preceding = MAIN_TS.slice(Math.max(0, index - 600), index).split('\n').slice(-8);
        return preceding
            .map(line => line.replace(/\r$/, '').trim())
            .filter(line => !line.startsWith('//') && !line.startsWith('*') && !line.startsWith('/*'))
            .some(line => line === 'stopCityAmbient();');
    };

    it('패널을 숨기는 모든 경로가 타이머를 함께 멈춘다', () => {
        // [결함] 출진 버튼 경로가 stopCityAmbient() 를 빠뜨려 0.5초 repaint 가
        // 세션 내내 흘렀다. 숨김 경로가 늘려나므로, 각 경로가 stop 과 짝을 이루는지
        // 코드로 확인해 다음 경로에서 같은 실수를 반복하지 않게 한다.
        const hideSites = [...MAIN_TS.matchAll(/cityDetailPanel\.style\.display = 'none';/g)];
        expect(hideSites.length).toBeGreaterThanOrEqual(2);
        for (const site of hideSites) {
            expect(
                hasStopCallBefore(site.index),
                'cityDetailPanel 은폐 지점이 stopCityAmbient() 호출 짝 없이 있다',
            ).toBe(true);
        }
    });

    it('씬 활성 클래스를 지우는 경로도 타이머를 멈춘다', () => {
        // is-active 가 남아 있으면 틱 가드가 통과해 숨겨진 캔버스를 계속 그린다.
        const removals = [...MAIN_TS.matchAll(/citySceneCanvas\?\.classList\.remove\('is-active'\)/g)];
        expect(removals.length).toBeGreaterThanOrEqual(1);
        for (const site of removals) {
            expect(
                hasStopCallBefore(site.index),
                'is-active 제거 지점이 stopCityAmbient() 호출 짝 없이 있다',
            ).toBe(true);
        }
    });
});
