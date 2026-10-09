// 참고 이미지(city_building_coordinate_guide_1672x940.png)에서 빨간 마커를 찾아
// 중심 좌표를 뽑는다. 눈으로 읽으면 ±20px 맴도니까 실제 픽셀로 계산한다.
// 사용법: node scripts/find-guide-markers.mjs "<png경로>"
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { inflateSync, deflateSync } from 'node:zlib';

const file = process.argv[2];
if (!file) {
    console.error('사용법: node scripts/find-guide-markers.mjs <png>');
    process.exit(1);
}
const buf = readFileSync(file);

// ── PNG 청크 파싱 ──────────────────────────────────────────────
let pos = 8;
let ihdr = null;
const idat = [];
while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
        ihdr = {
            width: data.readUInt32BE(0),
            height: data.readUInt32BE(4),
            bitDepth: data[8],
            colorType: data[9],
            interlace: data[12],
        };
    } else if (type === 'IDAT') {
        idat.push(data);
    } else if (type === 'IEND') {
        break;
    }
    pos += 12 + len;
}
if (!ihdr) throw new Error('IHDR 없음 — PNG 가 아니다');
if (ihdr.bitDepth !== 8) throw new Error(`bitDepth ${ihdr.bitDepth} 미지원`);
if (ihdr.interlace !== 0) throw new Error('interlaced PNG 미지원');
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.colorType];
if (!CHANNELS) throw new Error(`colorType ${ihdr.colorType} 미지원`);

const raw = inflateSync(Buffer.concat(idat));
const { width, height } = ihdr;
const stride = width * CHANNELS;
const px = new Uint8Array(width * height * CHANNELS);

// ── 비필터 복원 ───────────────────────────────────────────────
let rp = 0;
for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const rowStart = y * stride;
    for (let x = 0; x < stride; x++) {
        const cur = raw[rp++];
        const left = x >= CHANNELS ? px[rowStart + x - CHANNELS] : 0;
        const up = y > 0 ? px[rowStart - stride + x] : 0;
        const upLeft = x >= CHANNELS && y > 0 ? px[rowStart - stride + x - CHANNELS] : 0;
        let val;
        switch (filter) {
            case 0: val = cur; break;
            case 1: val = cur + left; break;
            case 2: val = cur + up; break;
            case 3: val = cur + ((left + up) >> 1); break;
            case 4: {
                const p = left + up - upLeft;
                const pa = Math.abs(p - left);
                const pb = Math.abs(p - up);
                const pc = Math.abs(p - upLeft);
                val = cur + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft);
                break;
            }
            default: throw new Error(`알 수 없는 필터 ${filter} (y=${y})`);
        }
        px[rowStart + x] = val & 0xff;
    }
}

// ── 빨간 픽셀 마스크 ──────────────────────────────────────────
const isRed = new Uint8Array(width * height);
for (let i = 0; i < width * height; i++) {
    const o = i * CHANNELS;
    const r = px[o];
    const g = CHANNELS >= 3 ? px[o + 1] : 0;
    const b = CHANNELS >= 3 ? px[o + 2] : 0;
    // 순수 붉은색 계열만. 격자선(옅은 주황/분홍)이나 배경(회청색)은 걸러진다.
    if (r >= 200 && g <= 90 && b <= 90) isRed[i] = 1;
}

// ── 연결 요소(4-방향) 라벨링 ──────────────────────────────────
const label = new Int32Array(width * height).fill(-1);
const components = [];
const stack = [];
for (let i = 0; i < isRed.length; i++) {
    if (!isRed[i] || label[i] !== -1) continue;
    const id = components.length;
    stack.length = 0;
    stack.push(i);
    label[i] = id;
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    while (stack.length) {
        const cur = stack.pop();
        const cx = cur % width;
        const cy = (cur / width) | 0;
        sumX += cx; sumY += cy; count++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        if (cx > 0 && isRed[cur - 1] && label[cur - 1] === -1) { label[cur - 1] = id; stack.push(cur - 1); }
        if (cx < width - 1 && isRed[cur + 1] && label[cur + 1] === -1) { label[cur + 1] = id; stack.push(cur + 1); }
        if (cy > 0 && isRed[cur - width] && label[cur - width] === -1) { label[cur - width] = id; stack.push(cur - width); }
        if (cy < height - 1 && isRed[cur + width] && label[cur + width] === -1) { label[cur + width] = id; stack.push(cur + width); }
    }
    components.push({ id, sumX, sumY, count, minX, maxX, minY, maxY });
}

// ── 마커 후보 선별 ────────────────────────────────────────────
// 마커 = 채워진 원. 정사각형에 가깝고(종횡비 0.6~1.6) 픽셀이 빽빽하며(밀도 > 0.5),
// 폭이 적당히 크다(10~40px). 격자선은 폭이 수백 px, 글자는 밀도가 낮다.
const markers = components.filter(c => {
    const w = c.maxX - c.minX + 1;
    const h = c.maxY - c.minY + 1;
    const ratio = w / h;
    const density = c.count / (w * h);
    return w >= 8 && w <= 60 && h >= 8 && h <= 60 && ratio >= 0.55 && ratio <= 1.8 && density >= 0.45;
});

const artIdx = Number((process.argv.find(a => a.startsWith('--art=')) ?? '--art=0').slice(6));
if (Number.isFinite(artIdx) && artIdx > 0) {
    const big = components.filter(c => c.count === 275).sort((a, b) => a.minY - b.minY || a.minX - b.minX);
    const c = big[artIdx - 1];
    const w = c.maxX - c.minX + 1;
    const h = c.maxY - c.minY + 1;
    console.log(`-- art #${artIdx}  origin=(${c.minX},${c.minY})  ${w}x${h} --`);
    for (let y = c.minY; y <= c.maxY; y++) {
        let line = '';
        for (let x = c.minX; x <= c.maxX; x++) line += isRed[y * width + x] ? '#' : '.';
        console.log(`${y} ${line}`);
    }
}

// ── 마커 콜아웃에서 앵커 점 추출 ────────────────────────────────
// 콜아웃 = "선행선(대각선) + 좌하단 채워진 원(앵커) + 우상단 번호 상자".
// 앵커는 채워진 원이므로, 반지름 5 만큼 침식하면 선(폭 3)과 글자(Number)는 사라지고
// 원의 심(core)만 남는다. 남은 픽셀의 무게중심이 앵커 중심이다.
const CALLOUT_W = 52;
const CALLOUT_H = 43;
const callouts = components.filter(c =>
    c.maxX - c.minX + 1 === CALLOUT_W && c.maxY - c.minY + 1 === CALLOUT_H);

const ERODE = 5;
function anchorOf(c) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = c.minY; y <= c.maxY; y++) {
        for (let x = c.minX; x <= c.maxX; x++) {
            if (!isRed[y * width + x]) continue;
            let solid = true;
            for (let dy = -ERODE; dy <= ERODE && solid; dy++) {
                for (let dx = -ERODE; dx <= ERODE; dx++) {
                    const qx = x + dx;
                    const qy = y + dy;
                    if (qx < 0 || qy < 0 || qx >= width || qy >= height || !isRed[qy * width + qx]) {
                        solid = false;
                        break;
                    }
                }
            }
            if (solid) { sx += x; sy += y; n++; }
        }
    }
    return n > 0 ? { x: sx / n, y: sy / n, core: n } : null;
}

const artHeight = 940; // 게임 자산 city-scene-base.webp 의 실제 높이
const results = callouts
    .map(c => ({ box: c, anchor: anchorOf(c) }))
    .filter(r => r.anchor !== null)
    .sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);

console.log(`이미지 ${width}x${height} · 콜아웃 ${callouts.length}개 · 앵커 ${results.length}개`);
console.log('번호   앵커 px(중심)        앵커 %(그림 1672x' + artHeight + ')   콜아웃 원점');
results.forEach((r, i) => {
    const a = r.anchor;
    console.log(
        `${String(i + 1).padStart(2)}    ` +
        `(${a.x.toFixed(1)}, ${a.y.toFixed(1)})`.padEnd(20) +
        `(${a.x / width * 100}, ${(a.y / artHeight * 100).toFixed(1)})`.padEnd(26) +
        `(${r.box.minX}, ${r.box.minY})  core=${a.core}`,
    );
});

// ── 검증용 크롭 PNG 출력 ────────────────────────────────────────
function crc32(buf) {
    let c = ~0;
    for (let i = 0; i < buf.length; i++) {
        c ^= buf[i];
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
}
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}
function writeCrop(path, ox, oy, cw, ch, marks) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(cw, 0);
    ihdr.writeUInt32BE(ch, 4);
    ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
    const rawRows = Buffer.alloc((cw * 4 + 1) * ch);
    let rp = 0;
    for (let y = 0; y < ch; y++) {
        rawRows[rp++] = 0;
        for (let x = 0; x < cw; x++) {
            const sx = Math.min(width - 1, Math.max(0, ox + x));
            const sy = Math.min(height - 1, Math.max(0, oy + y));
            const so = (sy * width + sx) * CHANNELS;
            const r = px[so];
            const g = CHANNELS >= 3 ? px[so + 1] : 0;
            const b = CHANNELS >= 3 ? px[so + 2] : 0;
            // 앵커 십자 표시(청록) — 눈으로 확인할 수 있게
            let rr = r; let gg = g; let bb = b;
            for (const m of marks) {
                const mx = Math.round(m.x) - ox;
                const my = Math.round(m.y) - oy;
                if (Math.abs(x - mx) <= 14 && Math.abs(y - my) <= 1) { rr = 0; gg = 255; bb = 255; }
                if (Math.abs(y - my) <= 14 && Math.abs(x - mx) <= 1) { rr = 0; gg = 255; bb = 255; }
            }
            rawRows[rp++] = rr; rawRows[rp++] = gg; rawRows[rp++] = bb; rawRows[rp++] = 255;
        }
    }
    const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', inflateSync ? deflateSync(rawRows) : rawRows),
        chunk('IEND', Buffer.alloc(0)),
    ]);
    writeFileSync(path, png);
}

const OUT_DIR = process.argv.find(a => a.startsWith('--out='))?.slice(6);
if (OUT_DIR) {
    mkdirSync(OUT_DIR, { recursive: true });
    const CROP_W = 420;
    const CROP_H = 260;
    results.forEach((r, i) => {
        const a = r.anchor;
        // 앵커가 크롭 중앙에 오게 하고, 라벨/건물이 함께 보이도록 여유를 둔다.
        const ox = Math.min(width - CROP_W, Math.max(0, Math.round(a.x) - CROP_W / 2));
        const oy = Math.min(height - CROP_H, Math.max(0, Math.round(a.y) - CROP_H / 2 + 40));
        writeCrop(`${OUT_DIR}/anchor-${String(i + 1).padStart(2, '0')}.png`, ox, oy, CROP_W, CROP_H, [a]);
    });
    console.log(`\n크롭 ${results.length}장 → ${OUT_DIR}`);
}
