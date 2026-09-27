/**
 * 능력치 레이더 — 5각 다각형 SVG.
 *
 * San7 편집 화면의 육각형 능력치 표를 텍스트로 옮긴 것이다.
 * 수치는 그대로 SVG 좌표로만 바꾸므로, 애니메이션이나 상태는 없다.
 * (조작은 슬라이더가 담당한다 — 레이더는 표시 전용)
 */

import type { OfficerStats } from './types.js';

export interface RadarAxis {
    key: keyof OfficerStats;
    label: string;
}

/** 순서는 화면의 시계 방향 순서를 따른다. */
export const RADAR_AXES: RadarAxis[] = [
    { key: 'leadership', label: '통솔' },
    { key: 'might', label: '무력' },
    { key: 'intelligence', label: '지력' },
    { key: 'politics', label: '정치' },
    { key: 'charisma', label: '매력' },
];

const SIZE = 200;
const CENTER = SIZE / 2;
const RADIUS = 68;

/** 각 축의 각도. -90도에서 시작해 시계 방향으로 72도씩. */
function angleOf(index: number): number {
    return (-90 + index * 72) * (Math.PI / 180);
}

function pointAt(index: number, ratio: number): { x: number; y: number } {
    const a = angleOf(index);
    return { x: CENTER + Math.cos(a) * RADIUS * ratio, y: CENTER + Math.sin(a) * RADIUS * ratio };
}

/** 0~100 능력치를 0~1 비율로. 범위를 벗어나면 잘라야 SVG 가 깨지지 않는다. */
function ratioOf(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value / 100));
}

function polygonFrom(ratios: number[]): string {
    return ratios
        .map((r, i) => {
            const p = pointAt(i, r);
            return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        })
        .join(' ');
}

/** 0.25 / 0.5 / 0.75 / 1.0 눈금 고리. */
const RINGS = [0.25, 0.5, 0.75, 1];

export interface RadarOptions {
    stats: OfficerStats;
    /** 눈금 고리 색 (기본 청록) */
    gridColor?: string;
    /** 다각형 채움 색 */
    fillColor?: string;
    strokeColor?: string;
}

/**
 * 레이더 차트 SVG 문자열.
 * 라벨은 차트 바깥에 배치해 다각형과 겹치지 않게 한다.
 */
export function renderRadarSvg(opts: RadarOptions): string {
    const grid = opts.gridColor ?? '#4a6a7a';
    const fill = opts.fillColor ?? 'rgba(80,170,200,0.45)';
    const stroke = opts.strokeColor ?? '#7fd0e8';

    const rings = RINGS.map(r =>
        `<polygon points="${polygonFrom(RADAR_AXES.map(() => r))}" fill="none" stroke="${grid}" stroke-width="0.7" opacity="0.55"/>`,
    ).join('');

    const spokes = RADAR_AXES.map((_, i) => {
        const p = pointAt(i, 1);
        return `<line x1="${CENTER}" y1="${CENTER}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke="${grid}" stroke-width="0.7" opacity="0.5"/>`;
    }).join('');

    const ratios = RADAR_AXES.map(a => ratioOf(opts.stats[a.key]));

    const dots = ratios.map((r, i) => {
        const p = pointAt(i, r);
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${stroke}" stroke="#0d1018" stroke-width="1"/>`;
    }).join('');

    const labels = RADAR_AXES.map((a, i) => {
        const p = pointAt(i, 1.24);
        const value = Math.round(ratioOf(opts.stats[a.key]) * 100);
        return `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" fill="#9aa4b8" font-size="10"
            text-anchor="middle" dominant-baseline="middle">${a.label} ${value}</text>`;
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="능력치 레이더">
  ${rings}
  ${spokes}
  <polygon points="${polygonFrom(ratios)}" fill="${fill}" stroke="${stroke}" stroke-width="1.6"/>
  ${dots}
  ${labels}
</svg>`;
}
