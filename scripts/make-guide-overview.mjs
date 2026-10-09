// 가이드 PNG 를 축소한 전체 조감도. 14개 앵커를 청록 십자로 겹쳐 그린다.
// 사용법: node scripts/make-guide-overview.mjs <guide.png> <out.png> [scale] [anchors.txt]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { pngToRaw } from './png_util.mjs';

const [file, out, scaleArg, anchorsFile] = process.argv.slice(2);
if (!file || !out) {
    console.error('사용법: node scripts/make-guide-overview.mjs <guide.png> <out.png> [scale] [anchors.txt]');
    process.exit(1);
}
const { width, height, rgba } = pngToRaw(readFileSync(file));
const scale = Math.max(1, Number(scaleArg) || 3);

/**
 * 텍스트를 읽되 인코딩을 감지한다.
 * PowerShell 의 `>` 리다이렉트는 UTF-16LE(BOM=FF FE)로 저장하는데, 그 경우
 * 문자 사이에 NUL 바이트가 끼어 정규식이 전부 조용히 실패한다. 조용한 실패가
 * 앵커 0개로 이어지면 "앵커가 없다"는 잘못된 결론을 내리므로 여기서 정리한다.
 */
function readTextSmart(path) {
    const buf = readFileSync(path);
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
        return buf.subarray(2).toString('utf16le');
    }
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
        return buf.subarray(3).toString('utf8');
    }
    return buf.toString('utf8');
}

// 앵커 목록 파싱 — find-guide-markers.mjs 출력의 "앵커 px(중심)" 열.
// 예: " 1    (780.0, 105.0)      (46.65, 11.2) (773, 70)  core=1"
// 첫 번째 괄호쌍이 앵커 중심이고, 마지막 괄호쌍이 콜아웃 박스 원점이다.
const anchors = [];
if (anchorsFile && existsSync(anchorsFile)) {
    for (const line of readTextSmart(anchorsFile).split(/\r?\n/)) {
        const m = line.match(/^\s*\d+\s+\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*\)/);
        if (m) anchors.push({ x: Number(m[1]), y: Number(m[2]) });
    }
}

const sw = Math.ceil(width / scale);
const sh = Math.ceil(height / scale);
const out8 = new Uint8Array(sw * sh * 4);
for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
        const so = (Math.min(height - 1, y * scale) * width + Math.min(width - 1, x * scale)) * 4;
        const d = (y * sw + x) * 4;
        out8[d] = rgba[so]; out8[d + 1] = rgba[so + 1]; out8[d + 2] = rgba[so + 2]; out8[d + 3] = 255;
    }
}

/** 원본 px 좌표에 청록 십자(반경 R)를 찍는다. 축소된 이미지에서도 보이도록 원본 단위로 그린다. */
const R = Math.max(4, 12 / scale);
for (const a of anchors) {
    const cx = Math.round(a.x / scale);
    const cy = Math.round(a.y / scale);
    for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
            if (Math.abs(dx) > 1 && Math.abs(dy) > 1) continue;
            const x = cx + dx;
            const y = cy + dy;
            if (x < 0 || y < 0 || x >= sw || y >= sh) continue;
            const d = (y * sw + x) * 4;
            out8[d] = 0; out8[d + 1] = 255; out8[d + 2] = 255;
        }
    }
}

const rows = Buffer.alloc((sw * 4 + 1) * sh);
let rp = 0;
for (let y = 0; y < sh; y++) {
    rows[rp++] = 0;
    for (let x = 0; x < sw; x++) {
        const so = (y * sw + x) * 4;
        rows[rp++] = out8[so]; rows[rp++] = out8[so + 1]; rows[rp++] = out8[so + 2]; rows[rp++] = 255;
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
ihdr.writeUInt32BE(sw, 0);
ihdr.writeUInt32BE(sh, 4);
ihdr[8] = 8;
ihdr[9] = 6;
writeFileSync(out, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
]));
console.log(`${out} ${sw}x${sh} (원본 ${width}x${height} 축소 ${scale}배, 앵커 ${anchors.length}개 표시)`);
