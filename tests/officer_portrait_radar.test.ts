/**
 * 무장 초상화 / 레이더 SVG 생성기.
 *
 * SVG 문자열이므로 "렌더가 깨지지 않는가" 를 기계적으로 확인할 수 있다.
 * 결정론(같은 id = 같은 SVG)이 깨지면 초상이 매번 바뀌는 버그가 된다.
 */
import { describe, it, expect } from 'vitest';
import { renderPortraitSvg } from '../src/core/officer_portrait.js';
import { renderRadarSvg, RADAR_AXES } from '../src/core/officer_radar.js';
import { OFFICER_PROFILES } from '../src/core/officer_profile_schema.js';

const opts = { id: 'off_0001', name: '한중윤', gender: 'M' as const, grade: 5 };

describe('renderPortraitSvg', () => {
    it('같은 id 는 항상 같은 SVG 다 (초상이 매번 바뀌면 안 된다)', () => {
        expect(renderPortraitSvg(opts)).toBe(renderPortraitSvg(opts));
    });

    it('다른 id 는 다른 SVG 다', () => {
        expect(renderPortraitSvg(opts)).not.toBe(
            renderPortraitSvg({ ...opts, id: 'off_0002' }));
    });

    it('이름이 달라도 얼굴은 같아야 한다 (id 가 기준이다)', () => {
        // aria-label 만 이름이 들어가므로 그것만 지우고 비교한다.
        const strip = (s: string): string => s.replace(/ aria-label="[^"]*"/, '');
        expect(strip(renderPortraitSvg(opts))).toBe(
            strip(renderPortraitSvg({ ...opts, name: '다른이름' })));
    });

    it('유효한 SVG 를 낸다', () => {
        const svg = renderPortraitSvg(opts);
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it('viewBox 가 100x100 이다 (좌표계 고정)', () => {
        expect(renderPortraitSvg(opts)).toContain('viewBox="0 0 100 100"');
    });

    it('XML 특수문자가 이스케이프된다 (이름에 <가 들어가면 SVG 가 깨진다)', () => {
        const svg = renderPortraitSvg({ ...opts, name: '<script>&"x"' });
        expect(svg).not.toContain('<script>');
        expect(svg).toContain('&lt;script&gt;');
    });

    it('SVG 내부 id 가 숫자/문자로만 이뤄진다 (id 로 쓸 수 없으면 참조가 깨진다)', () => {
        const svg = renderPortraitSvg(opts);
        const m = svg.match(/id="halo-([a-z0-9]+)"/);
        expect(m).not.toBeNull();
        expect(m![1]).toMatch(/^[a-z0-9]+$/);
    });

    it('성급이 높으면 투명도(광휘)가 올라간다', () => {
        const low = renderPortraitSvg({ ...opts, grade: 1 });
        const high = renderPortraitSvg({ ...opts, grade: 9 });
        const val = (s: string) => Number(s.match(/stop-opacity="([\d.]+)"/)![1]);
        expect(val(high)).toBeGreaterThan(val(low));
    });

    it('성별 어느 쪽이든 SVG 가 나온다', () => {
        expect(renderPortraitSvg({ ...opts, gender: 'F' })).toContain('</svg>');
        expect(renderPortraitSvg({ ...opts, gender: 'M' })).toContain('</svg>');
    });

    it('실제 1200명 전부에 대해 예외 없이 그려진다', () => {
        for (const p of OFFICER_PROFILES.all()) {
            const svg = renderPortraitSvg({
                id: p.id, name: p.name, gender: p.gender, grade: p.grade ?? 3,
            });
            expect(svg.startsWith('<svg')).toBe(true);
            expect(svg).toContain('</svg>');
        }
    });
});

describe('renderRadarSvg', () => {
    const stats = { leadership: 72, might: 45, intelligence: 91, politics: 60, charisma: 33 };

    it('축은 5개다', () => {
        expect(RADAR_AXES).toHaveLength(5);
        expect(RADAR_AXES.map(a => a.key)).toEqual(
            ['leadership', 'might', 'intelligence', 'politics', 'charisma']);
    });

    it('유효한 SVG 를 낸다', () => {
        const svg = renderRadarSvg({ stats });
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    });

    it('능력치 라벨이 5개 모두 들어간다', () => {
        const svg = renderRadarSvg({ stats });
        for (const a of RADAR_AXES) expect(svg).toContain(a.label);
    });

    it('실제 값이 라벨에 찍힌다', () => {
        const svg = renderRadarSvg({ stats });
        expect(svg).toContain('통솔 72');
        expect(svg).toContain('지력 91');
    });

    it('범위를 벗어난 값도 좌표가 유한하다 (NaN 이면 polygon 이 깨진다)', () => {
        for (const bad of [-999, 0, 100, 999, NaN, Infinity]) {
            const svg = renderRadarSvg({ stats: { ...stats, might: bad } });
            expect(svg).not.toContain('NaN');
            expect(svg).not.toContain('Infinity');
        }
    });

    it('눈금 고리 4개 + 축 5개가 그려진다', () => {
        const svg = renderRadarSvg({ stats });
        // 4 고리 + 1 데이터 다각형 = polygon 5개
        expect((svg.match(/<polygon/g) ?? []).length).toBe(5);
        expect((svg.match(/<line/g) ?? []).length).toBe(5);
    });

    it('같은 능력치면 같은 SVG 다', () => {
        expect(renderRadarSvg({ stats })).toBe(renderRadarSvg({ stats }));
    });

    it('전부 0 이어도 좌표가 유한하다', () => {
        expect(renderRadarSvg({
            stats: { leadership: 0, might: 0, intelligence: 0, politics: 0, charisma: 0 },
        })).not.toContain('NaN');
    });
});
