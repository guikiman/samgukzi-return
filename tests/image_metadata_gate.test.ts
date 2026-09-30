/**
 * [_meta] 배포 이미지 메타데이터 검사 — 도구가 실제로 잡는지 증명한다.
 *
 * [왜 이게 필요한가]
 * "메타데이터 없음" 이라는 출력은 **도구가 고장나도 똑같이 나온다.** 아무도 안 잡는
 * 검사가 통과를 가장 자주 한다. 그래서 합성 파일로 청크를 심어 실제로 잡히는지
 * 확인하고, 그래야 깨끗한 결과가 "없다"는 뜻이 된다.
 *
 * [왜 문자열 검색으로는 부족한가]
 * PNG 의 zTXt/iTXt 는 압축·UTF-16 이고, WebP 의 EXIF/XMP 는 RIFF 컨테이너 안에,
 * JPEG 는 APP1 마커 뒤에 있다. 전부 파일 구조를 파싱해야 잡힌다.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');
const SCRIPT = join(REPO_ROOT, 'scripts/inspect_image_metadata.mjs');
const TMP = mkdtempSync(join(tmpdir(), 'meta-gate-'));

afterAll(() => { rmSync(TMP, { recursive: true, force: true }); });

/** PNG CRC-32 (IEEE) — 청크를 실제로 유효하게 만들려면 필요하다. */
function crc32(buf: Buffer): number {
    let crc = 0xFFFFFFFF;
    for (const byte of buf) {
        crc ^= byte;
        for (let k = 0; k < 8; k++) {
            crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
        }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

/** 유효한 PNG 한 장을 읽어, 지정한 텍스트 청크를 IEND 앞에 삽입한다. */
function pngWithTextChunk(sourcePng: string, keyword: string, text: string, outPath: string): void {
    const buf = readFileSync(sourcePng);
    const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const payload = Buffer.concat([
        Buffer.from(keyword, 'latin1'), Buffer.from([0x00]), Buffer.from(text, 'latin1'),
    ]);
    const typeAndData = Buffer.concat([Buffer.from('tEXt', 'latin1'), payload]);
    const chunk = Buffer.concat([
        (() => { const l = Buffer.alloc(4); l.writeUInt32BE(payload.length); return l; })(),
        typeAndData,
        (() => { const c = Buffer.alloc(4); c.writeUInt32BE(crc32(typeAndData)); return c; })(),
    ]);
    // IEND 는 맨 뒤이므로, 그 앞에서 잘라 붙이면 된다.
    const iendAt = buf.lastIndexOf(Buffer.from('IEND', 'latin1')) - 4;
    writeFileSync(outPath, Buffer.concat([buf.subarray(0, iendAt), chunk, buf.subarray(iendAt)]));
}

/** RIFF/WebP 컨테이너에 EXIF 청크를 심은 파일. */
function webpWithExif(outPath: string, payloadText: string): void {
    const payload = Buffer.from(payloadText, 'latin1');
    const typeAndSize = Buffer.alloc(8);
    typeAndSize.write('EXIF ', 0, 'latin1');
    typeAndSize.writeUInt32LE(payload.length, 4);
    const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), typeAndSize, payload]);
    const header = Buffer.alloc(8);
    header.write('RIFF', 0, 'latin1');
    header.writeUInt32LE(body.length, 4);
    writeFileSync(outPath, Buffer.concat([header, body]));
}

function inspectJson(paths: string[]): Array<{ path: string; chunks: Array<{ chunk: string; preview?: string }> }> {
    const out = execFileSync(process.execPath, [SCRIPT, '--json', ...paths], { encoding: 'utf8', maxBuffer: 1 << 24 });
    return JSON.parse(out) as Array<{ path: string; chunks: Array<{ chunk: string; preview?: string }> }>;
}

const basePng = join(REPO_ROOT, 'src-tauri/icons/32x32.png');

describe('메타데이터 검사 도구', () => {
    it('PNG 텍스트 청크를 실제로 잡는다', () => {
        const out = join(TMP, 'with-text.png');
        // 원본 파일명이 남아 있으면 그것만으로도 출처가 드러난다.
        pngWithTextChunk(basePng, 'Software', 'Total War: Three Kingdoms', out);
        const [report] = inspectJson([out]);
        const chunks = report.chunks.map(c => c.chunk);
        expect(chunks, 'tEXt 청크를 잡지 못했다').toContain('tEXt');
        const text = report.chunks.map(c => c.preview ?? '').join(' ');
        expect(text).toContain('Software');
    });

    it('WebP EXIF 청크를 실제로 잡는다', () => {
        const out = join(TMP, 'with-exif.webp');
        webpWithExif(out, 'Photoshop 3.0 / Total War map');
        const [report] = inspectJson([out]);
        expect(report.chunks.map(c => c.chunk), 'EXIF 청크를 잡지 못했다').toContain('EXIF');
    });

    it('메타데이터가 없는 파일은 아무 것도 보고하지 않는다', () => {
        const [report] = inspectJson([basePng]);
        expect(report.chunks).toEqual([]);
    });

    it('--fail-on-meta 는 메타데이터가 있으면 종료 코드 1 을 준다', () => {
        const out = join(TMP, 'with-text2.png');
        pngWithTextChunk(basePng, 'Comment', 'derived from Total War', out);
        let code = 0;
        try {
            execFileSync(process.execPath, [SCRIPT, '--fail-on-meta', out], { encoding: 'utf8', stdio: 'pipe' });
        } catch (err) {
            code = (err as { status?: number }).status ?? 1;
        }
        expect(code, '메타데이터가 있는데 통과했다').toBe(1);
    });
});

describe('저장소 배포 자산', () => {
    it('추적되는 이미지 중 메타데이터가 남은 것이 없다', () => {
        const files = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
            .split('\n')
            .filter(p => /\.(png|jpe?g|webp|gif)$/i.test(p));
        expect(files.length, '검사 대상이 0개다 — 규칙이 빈 껍데기').toBeGreaterThanOrEqual(5);
        const dirty = inspectJson(files).filter(r => r.chunks.length > 0);
        expect(
            dirty.map(d => `${d.path}: ${d.chunks.map(c => c.chunk).join(',')}`),
            '메타데이터가 남은 자산이 있다 — 배포 전 제거할 것',
        ).toEqual([]);
    });
});
