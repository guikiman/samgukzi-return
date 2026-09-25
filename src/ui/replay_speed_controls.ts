/**
 * [312][461-480] 전투 리플레이 속도 UI 연결기.
 *
 * 허용된 네 프리셋만 선택할 수 있으며 알 수 없는 값은 항상 1x로 복구한다.
 * change 이벤트는 선택 즉시 발생하므로 뷰어의 다음 렌더 프레임부터 새 배율이 적용된다.
 */

export const REPLAY_SPEEDS = [0.5, 1, 2, 4] as const;
export type ReplaySpeed = typeof REPLAY_SPEEDS[number];
export const DEFAULT_REPLAY_SPEED: ReplaySpeed = 1;

export function normalizeReplaySpeed(value: unknown): ReplaySpeed {
    const speed = typeof value === 'number' ? value : Number(value);
    return REPLAY_SPEEDS.includes(speed as ReplaySpeed)
        ? speed as ReplaySpeed
        : DEFAULT_REPLAY_SPEED;
}

export class ReplaySpeedControls {
    private speed: ReplaySpeed = DEFAULT_REPLAY_SPEED;

    constructor(
        private readonly root: HTMLFieldSetElement,
        private readonly onSpeedChange: (speed: ReplaySpeed) => void,
    ) {
        const handleChange = (event: Event): void => {
            const input = event.currentTarget;
            if (input instanceof HTMLInputElement) this.setSpeed(input.value);
        };
        for (const input of this.inputs) input.addEventListener('change', handleChange);
        this.renderSelection();
    }

    get currentSpeed(): ReplaySpeed { return this.speed; }

    /** 손상된 값/기본 복구 경로 — 항상 1x를 선택하고 뷰어에도 전달한다. */
    reset(): void {
        this.setSpeed(DEFAULT_REPLAY_SPEED);
    }

    setSpeed(value: unknown): ReplaySpeed {
        this.speed = normalizeReplaySpeed(value);
        this.renderSelection();
        setTimeout(() => this.renderSelection(), 0);
        setTimeout(() => this.renderSelection(), 50);
        this.onSpeedChange(this.speed);
        return this.speed;
    }

    setVisible(visible: boolean): void {
        this.root.hidden = !visible;
    }

    setEnabled(enabled: boolean): void {
        for (const input of this.inputs) input.disabled = !enabled;
    }

    private get inputs(): HTMLInputElement[] {
        return Array.from(this.root.querySelectorAll<HTMLInputElement>('input[name="replay-speed"]'));
    }

    private renderSelection(): void {
        const selectedValue = String(this.speed);
        for (const input of this.inputs) input.checked = input.value === selectedValue;
        const current = this.root.querySelector<HTMLElement>('#replay-speed-current');
        if (current) current.textContent = `${this.speed}x`;
    }
}
