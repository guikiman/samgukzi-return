// @vitest-environment jsdom
/**
 * [312][461-480] 전투 리플레이 속도 선택 UI 테스트.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DEFAULT_REPLAY_SPEED,
    normalizeReplaySpeed,
    REPLAY_SPEEDS,
    ReplaySpeedControls,
} from '../src/ui/replay_speed_controls.js';

function fixture(): HTMLFieldSetElement {
    document.body.innerHTML = `
        <fieldset id="replay-speed-controls" hidden>
            <legend>재생 속도</legend>
            <label><input type="radio" name="replay-speed" value="0.5">0.5x</label>
            <label><input type="radio" name="replay-speed" value="1" checked>1x</label>
            <label><input type="radio" name="replay-speed" value="2">2x</label>
            <label><input type="radio" name="replay-speed" value="4">4x</label>
        </fieldset>`;
    return document.getElementById('replay-speed-controls') as HTMLFieldSetElement;
}

describe('[312][461-480] ReplaySpeedControls', () => {
    beforeEach(() => { fixture(); });

    it('0.5x/1x/2x/4x만 제공하며 1x가 기본 선택이다', () => {
        const onChange = vi.fn();
        const controls = new ReplaySpeedControls(fixture(), onChange);
        const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="replay-speed"]'));

        expect(inputs.map(input => input.value)).toEqual(['0.5', '1', '2', '4']);
        expect(inputs[1].checked).toBe(true);
        expect(controls.currentSpeed).toBe(1);
        expect(onChange).not.toHaveBeenCalled();
    });

    it('마우스·터치와 같은 change 이벤트로 즉시 선택을 반영한다', () => {
        const onChange = vi.fn();
        const controls = new ReplaySpeedControls(fixture(), onChange);
        const half = document.querySelector<HTMLInputElement>('input[value="0.5"]')!;
        const four = document.querySelector<HTMLInputElement>('input[value="4"]')!;

        half.click();
        expect(controls.currentSpeed).toBe(0.5);
        expect(half.checked).toBe(true);
        four.click();
        expect(controls.currentSpeed).toBe(4);
        expect(four.checked).toBe(true);
        expect(onChange).toHaveBeenLastCalledWith(4);
    });

    it('잘못된 속도는 제한 대신 안전한 기본 속도 1x로 복구한다', () => {
        const onChange = vi.fn();
        const controls = new ReplaySpeedControls(fixture(), onChange);

        for (const invalid of [undefined, null, Number.NaN, Number.POSITIVE_INFINITY, 0, 3, 8, 'fast', {}]) {
            expect(controls.setSpeed(invalid)).toBe(1);
        }
        expect(normalizeReplaySpeed('2')).toBe(2);
        expect(normalizeReplaySpeed('bad')).toBe(DEFAULT_REPLAY_SPEED);
        expect(document.querySelector<HTMLInputElement>('input[value="1"]')!.checked).toBe(true);
        expect(onChange).toHaveBeenLastCalledWith(1);
    });

    it('리플레이 시작 시 1x로 초기화하고 종료 상태에서는 선택 비활성화를 지원한다', () => {
        const onChange = vi.fn();
        const controls = new ReplaySpeedControls(fixture(), onChange);
        controls.setSpeed(4);
        controls.reset();
        controls.setVisible(true);
        controls.setEnabled(false);

        expect(controls.currentSpeed).toBe(1);
        expect(onChange).toHaveBeenLastCalledWith(1);
        expect(document.getElementById('replay-speed-controls')!.hidden).toBe(false);
        expect(Array.from(document.querySelectorAll<HTMLInputElement>('input[name="replay-speed"]'))
            .every(input => input.disabled)).toBe(true);
    });

    it('허용 프리셋 목록은 UI/뷰어가 공유하는 단일 상수다', () => {
        expect(REPLAY_SPEEDS).toEqual([0.5, 1, 2, 4]);
    });
});
