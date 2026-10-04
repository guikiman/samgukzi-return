// 14개 앵커를 각각 크롭해 2열 격자로 이어붙인 판독용 몽타주.
// 각 칸은 앵커 중심을 기준으로 한 창이므로 "점 ↔ 라벨" 관계가 한 화면에 들어온다.
// 사용법: node scripts/make-anchor-montage.mjs <guide.png> <out.png> <cols> <winW> <winH> <zoom> [offX,offY ...]
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { pngToRaw } from './png_util.mjs';

const [file, out, colsArg, winWArg, winHArg, zoomArg, ...anchors] = process.argv.slice(2);
if (!file || !out || anchors.length === 0) {
    console.error('사용법: node scripts/make-anchor-montage.mjs <guide.png> <out.png> <cols> <winW> <winH> <zoom> [x,y ...]');
    process.exit(1);
}
const { width, height, rgba } = pngToRaw(readFileSync(file));
const COLS = Number(colsArg) || 2;
const WIN_W = Number(winWArg) || 320;
const WIN_H = Number(winHArg) || 220;
const ZOOM = Number(zoomArg) || 2;
const GAP = 6;

const rows = Math.ceil(anchors.length / COLS);
const dstW = (WIN_W * COLS + GAP * (COLS - 1)) * ZOOM;
const dstH = (WIN_H * rows + GAP * (rows - 1)) * ZOOM;
const out8 = new Uint8Array(dstW * dstH * 4);
for (let i = 0; i < dstW * dstH; i++) {
    out8[i * 4] = 0; out8[i * 4 + 1] = 0; out8[i * 4 + 2] = 0; out8[i * 4 + 3] = 255;
}

anchors.forEach((spec, i) => {
    const [ax, ay] = spec.split(',').map(Number);
    // 앵커 중심이 칸 정중앙(오프셋)에 오도록 원점을 잡는다.
    const ox = Math.round(ax - WIN_W / 2 + Number(process.env.ANCHOR_OFF_X || 0));
    const oy = Math.round(ay - WIN_H / 2 + Number(process.env.ANCHOR_OFF_Y || 0));
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const baseX = (col * (WIN_W + GAP)) * ZOOM;
    const baseY = (row * (WIN_H + GAP)) * ZOOM;
    for (let y = 0; y < WIN_H * ZOOM; y++) {
        const sy = Math.max(0, Math.min(height - 1, oy + Math.floor(y / ZOOM)));
        for (let x = 0; x < WIN_W * ZOOM; x++) {
            const sx = Math.max(0, Math.min(width - 1, ox + Math.floor(x / ZOOM)));
            const so = (sy * width + sx) * 4;
            const dx = (baseY + y) * dstW + (baseX + x);
            out8[dx * 4] = rgba[so];
            out8[dx * 4 + 1] = rgba[so + 1];
            out8[dx * 4 + 2] = rgba[so + 2];
            out8[dx * 4 + 3] = 255;
        }
    }
});

const rawRows = Buffer.alloc((dstW * 4 + 1) * dstH);
let rp = 0;
for (let y = 0; y < dstH; y++) {
    rawRows[rp++] = 0;
    for (let x = 0; x < dstW; x++) {
        const so = (y * dstW + x) * 4;
        rawRows[rp++] = out8[so];
        rawRows[rp++] = out8[so + 1];
        rawRows[rp++] = out8[so + 2];
        rawRows[rp++] = 255;
    }
}

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
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(dstW, 0);
ihdr.writeUInt32BE(dstH, 4);
ihdr[8] = 8;
ihdr[9] = 6;
writeFileSync(out, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rawRows)),
    chunk('IEND', Buffer.alloc(0)),
]));
console.log(`${out} ${dstW}x${dstH} (${anchors.length}칸, ${COLS}열, 창 ${WIN_W}x${WIN_H} zoom=${ZOOM}, 원본 ${width}x${height})`);