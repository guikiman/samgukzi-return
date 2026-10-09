/**
 * AI 생성 도시 아이콘 → 게임 아틀라스 변환.
 *
 * [왜 이 스크립트가 필요한가]
 * AI 이미지 생성은 한 장에 아이콘 하나를 준다. 게임은 매 프레임 42~57개 도시를 그리고
 * 그 아이콘을 8~17px(축소) ~ 42px(확대)로 스케일한다. 즉
 *   - PNG를 그대로 쓰면 도시 수만큼 네트워크 요청이 된다(42~57회),
 *   - 세력색을 빼면 "누가 어느 도시를 차지했나"를 못 읽는다,
 *   - 배경이 투명하지 않으면 지도 위에 사각형이 깔린다.
 * 이 스크립트가 세 가지를 한 번에 해결한다: 4장을 가로 아틀라스 1장으로 합치고,
 * 백색 실루엣으로 만든 뒤(런타임에 세력색을 입힌다), 알파를 강제한다.
 *
 * [입력 — AI 원본 4장]
 * assets/city-icons-src/ 아래에 아래 이름으로 둔다(대소문자 무관):
 *   small.png   소도시 (망루)
 *   medium.png  중도시 (성곽)
 *   large.png   대도시 (대성)
 *   capital.png 수도  (대성 + 깃발)
 * 원본은 어떤 크기든 된다(정사각 권장, 배경은 흰색 또는 단색).
 *
 * [출력]
 *   assets/city-icons.webp   512×128 (셀 128×128 × 4)
 * 이 경로/크기/셀 순서는 src/core/china_map_renderer.ts 의 CITY_ICON_* 상수와
 * 1:1 이어야 한다. 여기서 규칙을 바꾸면 그쪽 상수도 같이 고쳐야 한다.
 *
 * [처리 순서 — 왜 이 순서인가]
 *   1. 흰색 배경 제거 (fuzz)  : AI 배경은 흰색/밝은 회색이 가장 많다.
 *   2. 최근접 리사이즈          : 도성은 42px까지 줄어드므로 부드러운 보간이 아니라
 *                                픽셀 하나를 흩뜨리지 않는 최근접이 형태를 보존한다.
 *                                (근접 리사이즈는 scripts/make_icons.mjs 와 동일 규칙)
 *   3. 중앙 정렬 + 여백 8%     : 셀을 꽉 차게 하면 인접 셀의 그림자가 새어온다.
 *   4. 백색 실루엣화            : 런타임이 'source-atop' 으로 세력색을 입힌다.
 *                                원본이 이미 색이 있으면 그 색이 남아 세력색과 섞인다.
 *   5. WebP 알파               : VP8L(무손실 알파). 지도 위 작은 아이콘이라 q90 으로 충분하다.
 *
 * [사용법]
 *   node scripts/build_city_icon_atlas.mjs           # 변환 + 검증 출력
 *   node scripts/build_city_icon_atlas.mjs --check   # 입력 4장 존재/크기만 확인(변환 없음)
 */
import { existsSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'assets', 'city-icons-src');
const OUT = join(ROOT, 'assets', 'city-icons.webp');

// ── 게임 코드와 공유해야 하는 규격 (china_map_renderer.ts 의 CITY_ICON_* 과 1:1) ──
const CELL = 128;          // CITY_ICON_CELL_PX
const CELLS = 4;           // CITY_ICON_CELL_COUNT
const ATLAS_W = CELL * CELLS;
const ATLAS_H = CELL;
const PAD_RATIO = 0.08;    // 셀 여백 8%
const WHITE_THRESHOLD = 200; // 이 밝기 이상이면 배경 흰색으로 간주
const FUZZ = 32;           // 경계값 근처는 페더링(계단현상 방지)

/**
 * 전환 zoom 값을 렌더러 상수에서 직접 읽는다 — 하드코딩하면 반드시 어긋난다.
 *
 * [왜 복사하지 않는가]
 * 스크립트에 1.6 을 적어두고 렌더러를 1.4 로 바꾸면, PROVENANCE note 에 "zoom >= 1.6" 이
 * 남는데 실제 전환은 1.4 다. 출처 대장이 거짓말을 하게 된다 — 이 저장소에서
 * asset 게이트가 가장 경계하는 종류의 드리프트다.
 */
function readSpriteMinZoom() {
    const src = readFileSync(join(ROOT, 'src', 'core', 'china_map_renderer.ts'), 'utf8');
    const m = src.match(/export const CITY_ICON_SPRITE_MIN_ZOOM = ([\d.]+);/);
    if (!m) {
        throw new Error(
            'china_map_renderer.ts 에서 CITY_ICON_SPRITE_MIN_ZOOM 을 찾지 못했다.\n' +
            '   스크립트와 렌더러의 규격이 어긋난 것이다 — 상수 이름을 확인하라.',
        );
    }
    return Number(m[1]);
}

/** 셀 순서 = 아틀라스 인덱스. china_map_renderer.ts 의 CITY_ICON_SLOT 과 동일 순서. */
const SLOTS = [
    { key: 'small', label: 'SMALL(망루)' },
    { key: 'medium', label: 'MEDIUM(성곽)' },
    { key: 'large', label: 'LARGE(대성)' },
    { key: 'capital', label: 'CAPITAL(대성+깃발)' },
];

/** src/ 아래 .png/.jpg/.webp/.jpeg 를 찾는다 — 확장자 대소문자 무관. */
function findSource(key) {
    if (!existsSync(SRC_DIR)) return null;
    for (const ext of ['png', 'PNG', 'jpg', 'jpeg', 'webp', 'WEBP']) {
        const p = join(SRC_DIR, `${key}.${ext}`);
        if (existsSync(p)) return p;
    }
    return null;
}

function run(cmd, args, opts = {}) {
    return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

/**
 * PNG 를 RGBA 로 표준출력으로 뽑는다 (ffmpeg).
 * 흰색 배경 제거는 여기서 하지 않는다 — 픽셀 접근은 pillow 가 훨씬 정확하고 빠르다.
 */
function decodeToRgba(path) {
    const out = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {
        maxBuffer: 256 * 1024 * 1024,
    });
    // 해상도는 ffprobe 로 따로 읽는다 (헤더 파싱하지 않아도 되는 표준 경로).
    const dims = JSON.parse(run('ffprobe', [
        '-v', 'error', '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'json', path,
    ])).streams[0];
    return { data: out, w: dims.width, h: dims.height };
}

/**
 * 흰색 배경 제거 — AI 배경은 흰색/밝은 회색이 압도적으로 많다.
 *
 * [알파가 이미 있으면 배경 제거를 건너뛴다]
 * PNG 로Transparent 배경이 이미 있는 원본(대부분의 AI 생성물은 그렇다)을 다시 흰색으로
 * 벗기면 반투명 가장자리까지 깎여 성벽이 얇아진다. 알파가 하나라도 있으면 있는 걸 쓴다.
 */
function stripWhiteBackground(data, w, h) {
    const out = Buffer.from(data);
    // 이미 투명 배경이 있으면 있는 알파를 신뢰한다 (재벗김 방지).
    let hasAlpha = false;
    for (let i = 3; i < out.length; i += 4) {
        if (out[i] < 250) { hasAlpha = true; break; }
    }
    if (hasAlpha) return out;
    for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        const r = out[o], g = out[o + 1], b = out[o + 2];
        // 밝기(Rec.709 근사). 흰색 배경과 어두운 도성을 밝기만으로 가른다.
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum >= WHITE_THRESHOLD) {
            out[o + 3] = 0;
        } else if (lum >= WHITE_THRESHOLD - FUZZ) {
            // 경계 페더 — 계단현상(halo) 없이 부드럽게 알파를 없앤다.
            const t = (lum - (WHITE_THRESHOLD - FUZZ)) / FUZZ;
            out[o + 3] = Math.round(out[o + 3] * t);
        }
    }
    return out;
}

/** 4바이트 RGBA 버퍼를 파일로 쓴다 (WebP 무손실 알파). */
function encodeWebp(rgba, w, h, outPath) {
    // libwebp 는 RGBA 를 ffmpeg 의 "rawvideo rgba" 로 바로 받는다 — PNG 중간 파일이
    // 필요 없다. 중간 파일을 쓰면 "임시 파일 지우기"를 잊었을 때 커밋 대상이 되고,
    // 그건 실제로 한 번 발생했다.
    run('ffmpeg', ['-v', 'error', '-y',
        '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', 'pipe:0',
        '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '1', '-quality', '90',
        outPath], { input: rgba, encoding: 'buffer' });
}

/**
 * 백색 실루엣화 — 런타임이 'source-atop' 으로 세력색을 입힐 수 있어야 한다.
 *
 * [왜 완전 백색이 아니라 음영을 남기는가]
 * 아이콘 42px 에서 실루엣만 남으면 "빈 도형" 이 된다. 원본의 명암을 그레이로 남겨둬야
 * 스프라이트가 질감을 갖고, 세력색 위에 그 음영이 살아서 성벽/지붕이 구분된다.
 * 그래서 "최대값 대비 비율"로 정규화한다 — 백색(1.0)은 그대로, 어두운 부분만 낮아진다.
 */
function toWhiteSilhouette(rgba) {
    const out = Buffer.from(rgba);
    let maxLum = 1;
    for (let i = 0; i < out.length; i += 4) {
        if (out[i + 3] === 0) continue;
        const lum = 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
        if (lum > maxLum) maxLum = lum;
    }
    for (let i = 0; i < out.length; i += 4) {
        const a = out[i + 3];
        if (a === 0) { out[i] = out[i + 1] = out[i + 2] = 255; continue; }
        const lum = 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
        const v = Math.max(0, Math.min(255, Math.round((lum / maxLum) * 255)));
        out[i] = v; out[i + 1] = v; out[i + 2] = v;
    }
    return out;
}

/**
 * 알파 바운딩박스만 남기고 중앙 정렬 + 여백 8% 로 배치한다.
 *
 * AI 원본은 피사체가 프레임 안에 작게 앉아 있는 경우가 많다(예: 1024×1024 의 가운데 40%).
 * 그대로 128 로 줄이면 아이콘이 셀의 일부만 차지해 작게 보인다. 바운딩박스를 찾아
 * 최대 크기로 키운 뒤 중앙에 놓는다 — 그래야 4개 셀이 같은optic 크기로 보인다.
 */
function fitIntoCell(rgba, w, h) {
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            if (rgba[(y * w + x) * 4 + 3] === 0) continue;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }
    }
    // 알파가 하나도 없으면 투명 셀(게임에서는 "빈 아이콘" 이 되어 벡터로 안 빠진다).
    // 그래서 빈 칸이면 오류를 던져 AI 결과물이 실패했음을 숨기지 않는다.
    if (maxX < 0) throw new Error('알파가 0 픽셀뿐이다 — 흰 배경 제거가 과했다');

    const inner = Math.floor(CELL * (1 - PAD_RATIO * 2));
    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    // 종횡비를 유지하며 inner 에 맞춘다 (가로로 넘치면 가로 기준).
    const scale = Math.min(inner / bw, inner / bh);
    const dw = Math.max(1, Math.round(bw * scale));
    const dh = Math.max(1, Math.round(bh * scale));
    const dx = Math.floor((CELL - dw) / 2);
    const dy = Math.floor((CELL - dh) / 2);

    const cell = Buffer.alloc(CELL * CELL * 4, 0);
    for (let y = 0; y < dh; y++) {
        const sy = minY + Math.floor(y / scale);
        for (let x = 0; x < dw; x++) {
            const sx = minX + Math.floor(x / scale);
            const so = (sy * w + sx) * 4;
            const dst = ((dy + y) * CELL + (dx + x)) * 4;
            cell[dst] = rgba[so];
            cell[dst + 1] = rgba[so + 1];
            cell[dst + 2] = rgba[so + 2];
            cell[dst + 3] = rgba[so + 3];
        }
    }
    return { cell, dw, dh };
}

// ── 메인 ──
const checkOnly = process.argv.includes('--check');

console.log(`[city-icons] 원본 디렉터리: ${SRC_DIR}`);
if (!existsSync(SRC_DIR)) {
    console.error('[city-icons] 디렉터리가 없다. AI 원본 4장을 아래 이름으로 넣으세요:');
    for (const s of SLOTS) console.error(`   assets/city-icons-src/${s.key}.png   (${s.label})`);
    process.exit(1);
}

const sources = SLOTS.map((s) => ({ ...s, path: findSource(s.key) }));
const missing = sources.filter((s) => !s.path);

if (missing.length) {
    console.error(`[city-icons] 원본 ${missing.length} 장이 없다:`);
    for (const m of missing) console.error(`   ${m.key}.png   (${m.label})`);
    process.exit(1);
}

for (const s of sources) {
    const kb = (statSync(s.path).size / 1024).toFixed(1);
    console.log(`  ✓ ${s.key.padEnd(8)} ${s.label.padEnd(18)} ${kb.padStart(8)} KB  ${s.path.replace(ROOT, '.')}`);
}

if (checkOnly) {
    console.log('[city-icons] --check: 입력 확인 완료 (변환 없음)');
    process.exit(0);
}

console.log(`[city-icons] ${ATLAS_W}×${ATLAS_H} 아틀라스로 변환 중 (셀 ${CELL}×${CELL} × ${CELLS})…`);
const atlas = Buffer.alloc(ATLAS_W * ATLAS_H * 4, 0);

for (let i = 0; i < SLOTS.length; i++) {
    const src = sources[i];
    let decoded;
    try {
        decoded = decodeToRgba(src.path);
    } catch (err) {
        console.error(`[city-icons] ${src.key} 디코드 실패: ${err.message}`);
        process.exit(1);
    }
    const stripped = stripWhiteBackground(decoded.data, decoded.w, decoded.h);
    const silhouette = toWhiteSilhouette(stripped);
    const { cell, dw, dh } = fitIntoCell(silhouette, decoded.w, decoded.h);

    // 가로로 이어 붙인다 — 인덱스 = CITY_ICON_SLOT 값.
    const originX = i * CELL;
    for (let y = 0; y < CELL; y++) {
        cell.copy(atlas, (y * ATLAS_W + originX) * 4, y * CELL * 4, (y + 1) * CELL * 4);
    }
    console.log(`  · 셀 ${i} ${src.label.padEnd(18)} 원본 ${decoded.w}×${decoded.h} → 배치 ${dw}×${dh} / ${CELL}`);
}

// ── 출처 대장 + 서비스워커 등록 ────────────────────────────────────────────
// [왜 스크립트가 자동 등록하는가]
// assets/ 아래 바이너리는 전부 assets/PROVENANCE.json 에 sha256 으로 등록돼야 한다
// (scripts/check_ip_assets.mjs — "미등록 자산 = 위반"). 손으로 적으면 두 가지가 틀린다:
// sha256 을 폰으로 읽어 잘못 적거나, 대장에만 있는 항목을 남긴다(파일 없음 → 게이트가 잡는다).
// 여기서는 실제 파일을 읽어 해시를 계산하므로 둘 다 원천 봉쇄된다.
//
// [license 를 UNVERIFIED 로 남기는 이유]
// AI 원본의 생성 경위는 이 스크립트가 알 수 없다(어느 모델, 어느 프롬프트, 원본 참조 여부).
// 그래서 자동 등록은 "근거 없음" 상태로 끝낸다 — check_ip_assets 가 UNVERIFIED 를
// 위반으로 취급하므로 커밋이 막히고, 작성자가 근거를 적어 다시 실행해야 통과한다.
// 이게 이 저장소 AssetGate.pm 의 의도(조용한 통과를 불허)다.

// PROVENANCE.json 은 4스페이스 들여쓰기로 커밋되어 있다 — 같은 형식을 유지한다.
const PROVENANCE = join(ROOT, 'assets', 'PROVENANCE.json');
const SW_JS = join(ROOT, 'sw.js');

function registerAsset() {
    const relPath = 'assets/city-icons.webp';
    const sha256 = createHash('sha256').update(readFileSync(OUT)).digest('hex');
    const bytes = statSync(OUT).size;

    // ── PROVENANCE.json 갱신 ──
    const ledger = JSON.parse(readFileSync(PROVENANCE, 'utf8'));
    ledger.assets = (ledger.assets ?? []).filter((a) => a.path !== relPath);
    ledger.assets.push({
        path: relPath,
        sha256,
        bytes,
        source: 'AI 생성 도시 아이콘(txt2img) 4장을 scripts/build_city_icon_atlas.mjs 로 WebP 아틀라스화 — 생성 도구/모델/프롬프트는 미기록',
        license: 'UNVERIFIED — AI 원본의 생성 경위(도구·모델·프롬프트·원본 참조 여부)를 작성자가 확인하고 이 문장을 실제 라이선스로 바꿔라.',
        method: 'ai-generated',
        note: `확대 구간(zoom >= ${readSpriteMinZoom()}) 전용 도시 아이콘. ${ATLAS_W}×${ATLAS_H} WebP 무손실 알파, 셀 ${CELL}×${CELL} × ${CELLS}: 0 SMALL(망루) / 1 MEDIUM(성곽) / 2 LARGE(대성) / 3 CAPITAL(대성+깃발). 백색 실루엣이며 세력색은 런타임에 source-atop 으로 입힌다(china_map_renderer.ts 의 CITY_ICON_*). 축소 구간은 같은 tier 판정을 쓰는 벡터로 그린다. 원본 4장은 assets/city-icons-src/ 에 두고 변환 스크립트로 재현 가능하다.`,
    });
    writeFileSync(PROVENANCE, JSON.stringify(ledger, null, 4) + '\n', 'utf8');
    console.log(`[provenance] ${relPath} 등록 (sha256 ${sha256.slice(0, 16)}…, ${bytes} bytes)`);
    console.log('[provenance] ⚠ license 가 UNVERIFIED 다 — ip-gate 가 막는다.');
    console.log('[provenance]   생성 경위를 확인한 뒤 PROVENANCE.json 의 license 문장을 실제 근거로 바꾸라.');

    // ── sw.js 프리캐시 + 캐시 버전 bump ──
    // 프리캐시에 없으면 오프라인에서 아틀라스가 503 → 벡터로 조용히 폴백한다.
    // "조용히" 가 문제다(화면이 그럴듯한데 다르다). 그래서 반드시 등록한다.
    let sw = readFileSync(SW_JS, 'utf8');
    if (!sw.includes(relPath)) {
        // PRECACHE_PATHS 의 마지막 항목 뒤에 넣는다 — 앵커는 주석 문자열이라 견고하다.
        sw = sw.replace(
            /(\n\s*'src\/data\/scenarios\/index\.json',)/,
            `\n    // 확대 구간 도시 아이콘 아틀라스(AI 생성). 없으면 오프라인에서 벡터로 조용히 폴백한다.\n    '${relPath}',$1`,
        );
        // CACHE_NAME bump — 목록이 바뀌었으므로 bump 없이는 기존 설치본이 갱신되지 않는다.
        sw = sw.replace(/const CACHE_NAME = 'samgukzi-return-v(\d+)';/, (m, v) =>
            `const CACHE_NAME = 'samgukzi-return-v${Number(v) + 1}';`);
        writeFileSync(SW_JS, sw, 'utf8');
        console.log('[sw.js] PRECACHE_PATHS 추가 + CACHE_NAME bump 완료');
    } else {
        console.log('[sw.js] 이미 등록돼 있다 — 건너뜀');
    }
}

// RGBA → WebP(무손실 알파) 직접 인코딩 — 중간 파일이 없으므로 임시 파일을 깎을 걱정이 없다.
mkdirSync(dirname(OUT), { recursive: true });
encodeWebp(atlas, ATLAS_W, ATLAS_H, OUT);

const outBytes = statSync(OUT).size;
const outDims = JSON.parse(run('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,pix_fmt',
    '-of', 'json', OUT,
])).streams[0];

console.log('');
console.log(`✅ assets/city-icons.webp  ${outDims.width}×${outDims.height}  ${(outBytes / 1024).toFixed(1)} KB  (${outDims.pix_fmt})`);
if (outDims.width !== ATLAS_W || outDims.height !== ATLAS_H) {
    console.error(`❌ 규격 불일치 — 기대 ${ATLAS_W}×${ATLAS_H}. china_map_renderer.ts 의 CITY_ICON_* 를 확인하라.`);
    process.exit(1);
}
console.log('');
registerAsset();
console.log('');
console.log('다음 단계:');
console.log('  1) npm run build 후 지도를 zoom 1.6 이상으로 키워 확인');
console.log('  2) scripts/crop-guide-region.mjs 등으로 셀 4장이 의도대로 나왔는지 육안 확인');