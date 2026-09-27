/**
 * 무장 초상화 — SVG procedural 생성기.
 *
 * 왜 이미지 파일이 아니라 SVG 인가:
 * - San7 등 상용 게임의 초상화는 저작권 자산이라 가져올 수 없다.
 *   이 프로젝트는 저작권 게이트가 걸려 있으므로 더 그렇다.
 * - 실제 무장이 1200명이라 그림을 그리는 일도 불가능하다.
 * - 그래서 무장 ID 를 해시해 얼굴 특징을 결정적으로 만든다.
 *   같은 무장은 언제 봐도 같은 얼굴이고, 다른 무장은 절대 겹치지 않는다.
 *
 * 결정론: id 문자열만으로 전부 결정된다. 시드를 따로 받지 않는다.
 */

import { hashSeed } from './custom_officer_start.js';

/** 얼굴 특징 하나하나가 가질 수 있는 값. 해시로 뽑는다. */
interface FaceTraits {
    skin: string;
    hair: string;
    robe: string;
    trim: string;
    /** 얼굴형 (oval / square / round / long) */
    face: 'oval' | 'square' | 'round' | 'long';
    /** 수염 (none / moustache / beard / goatee) */
    facial: 'none' | 'moustache' | 'beard' | 'goatee';
    /** 모자 (none / guan / helmet) */
    hat: 'none' | 'guan' | 'helmet';
    browTilt: number;
    eyeSize: number;
}

const SKINS = ['#e8c9a8', '#dcb894', '#d0a87c', '#e3bda0', '#c99a72'];
const HAIRS = ['#2b1d12', '#1a1008', '#3d2a18', '#241a10'];
const ROBES = ['#7b2d2d', '#2d4a7b', '#2d6b4a', '#6b4a1f', '#4a2d6b', '#7b6a2d', '#3a3a4a'];
const TRIMS = ['#d4af6a', '#c0c4cc', '#b8863b', '#9aa4b8', '#8b2f2f'];

function pick<T>(arr: readonly T[], seed: number, salt: number): T {
    return arr[(seed + salt * 2654435761) % arr.length];
}

function faceTraits(id: string, grade: number, female: boolean): FaceTraits {
    const seed = hashSeed(id);
    return {
        skin: pick(SKINS, seed, 1),
        hair: pick(HAIRS, seed, 2),
        robe: pick(ROBES, seed, 3),
        trim: pick(TRIMS, seed, 4),
        face: (['oval', 'square', 'round', 'long'] as const)[(seed + 5) % 4],
    // 여자는 장 Beard 를 이지 않는다. 속성 타입을 잘못 만들면 tsc 가 잡아준다.
    facial: female
            ? ((seed % 3 === 0 ? 'none' : 'goatee') as FaceTraits['facial'])
            : (['none', 'moustache', 'beard', 'goatee'] as const)[(seed + 7) % 4],
        hat: grade >= 7 ? 'helmet' : grade >= 4 ? 'guan' : (['none', 'guan'] as const)[(seed + 9) % 2],
        browTilt: (seed % 5) - 2,
        eyeSize: 3 + (seed % 3),
    };
}

/** 얼굴 윤곽 — face 타입마다 폭/높이를 바꾼다. */
function facePath(t: FaceTraits): string {
    switch (t.face) {
        case 'square': return 'M31,33 Q50,24 69,33 Q71,52 66,62 Q50,72 34,62 Q29,52 31,33 Z';
        case 'round': return 'M30,36 Q50,23 70,36 Q73,58 50,68 Q27,58 30,36 Z';
        case 'long': return 'M34,30 Q50,22 66,30 Q69,52 63,66 Q50,76 37,66 Q31,52 34,30 Z';
        case 'oval':
        default: return 'M32,33 Q50,23 68,33 Q70,52 62,63 Q50,70 38,63 Q30,52 32,33 Z';
    }
}

/**
 * 머리카락 — scalp 를 덮되 얼굴 윤곽을 따라간다.
 * 모자(guan/helmet) 를 쓸 때는 뒤로 넘긴 머리로 보이게 앞을 비운다.
 */
function hairPath(t: FaceTraits): string {
    if (t.hat !== 'none') {
        // 관을 쓸 때: 뒤로 넘긴 머리 + 관아래 삐져나온 옆머리
        return `<path d="M32,36 Q30,20 50,19 Q70,20 68,36 Q64,26 50,25 Q36,26 32,36 Z" fill="${t.hair}"/>
                <path d="M31,36 Q28,46 32,52 L36,50 Q33,44 35,37 Z" fill="${t.hair}"/>
                <path d="M69,36 Q72,46 68,52 L64,50 Q67,44 65,37 Z" fill="${t.hair}"/>`;
    }
    switch (t.face) {
        case 'square':
            return `<path d="M30,40 Q28,20 50,19 Q72,20 70,40 Q68,28 50,27 Q32,28 30,40 Z" fill="${t.hair}"/>
                    <path d="M30,40 Q29,52 34,58 L38,55 Q34,48 35,40 Z" fill="${t.hair}"/>
                    <path d="M70,40 Q71,52 66,58 L62,55 Q66,48 65,40 Z" fill="${t.hair}"/>`;
        case 'round':
            return `<path d="M29,42 Q26,21 50,20 Q74,21 71,42 Q69,29 50,28 Q31,29 29,42 Z" fill="${t.hair}"/>
                    <path d="M29,42 Q28,54 33,60 L37,57 Q33,50 34,42 Z" fill="${t.hair}"/>
                    <path d="M71,42 Q72,54 67,60 L63,57 Q67,50 66,42 Z" fill="${t.hair}"/>`;
        case 'long':
            return `<path d="M32,38 Q30,18 50,17 Q70,18 68,38 Q66,25 50,24 Q34,25 32,38 Z" fill="${t.hair}"/>
                    <path d="M32,38 Q30,56 35,70 L40,66 Q35,52 36,38 Z" fill="${t.hair}"/>
                    <path d="M68,38 Q70,56 65,70 L60,66 Q65,52 64,38 Z" fill="${t.hair}"/>`;
        case 'oval':
        default:
            return `<path d="M31,40 Q29,19 50,18 Q71,19 69,40 Q67,27 50,26 Q33,27 31,40 Z" fill="${t.hair}"/>
                    <path d="M31,40 Q30,52 35,59 L39,56 Q35,48 36,40 Z" fill="${t.hair}"/>
                    <path d="M69,40 Q70,52 65,59 L61,56 Q65,48 64,40 Z" fill="${t.hair}"/>`;
    }
}

/** 눈썹 — 기울기를 얼굴 특징으로 쓴다. */
function brows(t: FaceTraits): string {
    const { browTilt: k } = t;
    return `<path d="M${39 - k},${40 - k} L${46 - k},${41 - k}" stroke="${t.hair}" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M${54 + k},${41 + k} L${61 + k},${40 + k}" stroke="${t.hair}" stroke-width="1.8" stroke-linecap="round"/>`;
}


export interface PortraitOptions {
    id: string;
    name: string;
    gender: 'M' | 'F';
    grade: number;
}

/**
 * 무장 초상화 SVG 문자열을 돌려준다.
 * viewBox 는 100x100 이고, 배경(광휘) + 상반신 + 머리 순으로 그린다.
 */
export function renderPortraitSvg(opts: PortraitOptions): string {
    const t = faceTraits(opts.id, opts.grade, opts.gender === 'F');
    const female = opts.gender === 'F';
    // 성급이 높을수록 배경 광휘가 강해진다 (San7 의 '장수' 강조 느낌)
    const halo = 0.35 + Math.min(0.5, opts.grade / 18);
    const haloColor = opts.grade >= 7 ? '#e8c06a' : '#8a6a4a';

    const hat = t.hat === 'helmet'
        ? `<path d="M28,32 Q50,14 72,32 L72,38 Q50,30 28,38 Z" fill="${t.trim}" stroke="#2a2018" stroke-width="0.8"/>
           <path d="M50,16 L54,26 L46,26 Z" fill="${t.trim}" stroke="#2a2018" stroke-width="0.6"/>`
        : t.hat === 'guan'
            ? `<rect x="30" y="18" width="40" height="8" rx="2" fill="${t.robe}" stroke="#2a2018" stroke-width="0.8"/>
               <path d="M34,26 L66,26 L62,34 L38,34 Z" fill="${t.robe}" stroke="#2a2018" stroke-width="0.6"/>`
            : '';

    const facial = t.facial === 'moustache'
        ? `<path d="M42,52 Q50,56 58,52" stroke="${t.hair}" stroke-width="1.6" fill="none" stroke-linecap="round"/>`
        : t.facial === 'beard'
            ? `<path d="M38,52 Q50,72 62,52 Q50,58 38,52 Z" fill="${t.hair}"/>`
            : t.facial === 'goatee'
                ? `<path d="M45,56 Q50,64 55,56 Z" fill="${t.hair}"/>`
                : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="${escapeXml(opts.name)} 초상화">
  <defs>
    <radialGradient id="halo-${svgId(opts.id)}" cx="50%" cy="42%" r="60%">
      <stop offset="0%" stop-color="${haloColor}" stop-opacity="${halo.toFixed(2)}"/>
      <stop offset="100%" stop-color="${haloColor}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" fill="#1a1410"/>
  <circle cx="50" cy="46" r="42" fill="url(#halo-${svgId(opts.id)})"/>
  <path d="M50,64 C30,64 18,78 14,100 L86,100 C82,78 70,64 50,64 Z" fill="${t.robe}" stroke="#20180f" stroke-width="1"/>
  <path d="M50,64 L44,78 L50,100 L56,78 Z" fill="${t.trim}" opacity="0.85"/>
  <path d="${facePath(t)}" fill="${t.skin}" stroke="#3a2c1e" stroke-width="0.8"/>
  ${hairPath(t)}
  <ellipse cx="${50 - 8}" cy="45" rx="${t.eyeSize}" ry="${(t.eyeSize * 0.7).toFixed(1)}" fill="#2a1a10"/>
  <ellipse cx="${50 + 8}" cy="45" rx="${t.eyeSize}" ry="${(t.eyeSize * 0.7).toFixed(1)}" fill="#2a1a10"/>
  ${brows(t)}
  <path d="M50,48 L50,53" stroke="#a07a5a" stroke-width="0.8"/>
  <path d="M46,57 Q50,${female ? 60 : 58} 54,57" stroke="#8a5a45" stroke-width="0.9" fill="none" stroke-linecap="round"/>
  ${facial}
  ${hat}
</svg>`;
}

/** SVG 안에서 id 로 쓰이는 문자열 — '#' 같은 문자를 id 에 넣으면 깨진다. */
function svgId(id: string): string {
    return (hashSeed(id) >>> 0).toString(36);
}

/** 이름은 사용자 입력이라 반드시 이스케이프한다. */
function escapeXml(s: string): string {
    return s.replace(/[<>&"']/g, c => (
        { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c] as string
    ));
}
