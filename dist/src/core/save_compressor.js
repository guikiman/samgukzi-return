/**
 * [Task 59] LZ-string 압축 엔진 연동 — SaveCompressor
 *
 * 세이브 데이터를 압축/해제하여 로컬스토리지 한계 극복.
 * LZW 기반이며 UTF-16 코드 단위 전체(0~65535)를 단일 문자 코드로 사용하고
 * 사전 코드는 65536부터 시작해 코드 공간 충돌이 없음 (유니코드 안전, 무손실).
 */
const LZ2_PREFIX = 'LZ2:';
const UNIT_BASE = 65536; // 사전 코드 시작점 (단일 코드 단위와 충돌 없음)
export class SaveCompressor {
    compress(data) {
        return this.lzCompress(data);
    }
    decompress(data) {
        return this.lzDecompress(data);
    }
    getCompressionRatio(original, compressed) {
        const origSize = new TextEncoder().encode(original).length;
        const compSize = new TextEncoder().encode(compressed).length;
        if (origSize === 0)
            return 1;
        return Math.round((1 - compSize / origSize) * 100) / 100;
    }
    isCompressed(data) {
        return data.startsWith(LZ2_PREFIX);
    }
    /**
     * UTF-16 코드 단위 단위 LZW 압축.
     * 출력 코드 n을 2개의 코드 단위(하위 16bit / 상위 16bit)로 인코딩해
     * 사전 코드가 65535를 넘어도 안전하다.
     */
    lzCompress(uncompressed) {
        const data = uncompressed + '';
        if (data.length === 0)
            return LZ2_PREFIX;
        const dictionary = new Map();
        let dictSize = UNIT_BASE;
        const out = [];
        let current = data[0];
        for (let i = 1; i < data.length; i++) {
            const ch = data[i];
            const combined = current + ch;
            if (dictionary.has(combined)) {
                current = combined;
            }
            else {
                out.push(current.length === 1 ? current.charCodeAt(0) : dictionary.get(current));
                dictionary.set(combined, dictSize++);
                current = ch;
            }
        }
        out.push(current.length === 1 ? current.charCodeAt(0) : dictionary.get(current));
        let body = '';
        for (const code of out) {
            body += String.fromCharCode(code & 0xFFFF, (code >>> 16) & 0xFFFF);
        }
        return LZ2_PREFIX + body;
    }
    lzDecompress(compressed) {
        if (!compressed.startsWith(LZ2_PREFIX))
            return compressed;
        const body = compressed.slice(LZ2_PREFIX.length);
        if (body.length === 0)
            return '';
        if (body.length % 2 !== 0) {
            throw new Error('Invalid compressed save: truncated code unit');
        }
        // 2 코드 단위 → 1 코드 복원
        const codes = [];
        for (let i = 0; i < body.length; i += 2) {
            codes.push(body.charCodeAt(i) | (body.charCodeAt(i + 1) << 16));
        }
        const dictionary = new Map();
        let dictSize = UNIT_BASE;
        const result = [];
        // 첫 코드는 항상 단일 코드 단위
        let prev = String.fromCharCode(codes[0]);
        result.push(prev);
        for (let i = 1; i < codes.length; i++) {
            const code = codes[i];
            let entry;
            if (code < UNIT_BASE) {
                entry = String.fromCharCode(code);
            }
            else if (dictionary.has(code)) {
                entry = dictionary.get(code);
            }
            else if (code === dictSize) {
                // KwKwK 케이스: 직전 문자열의 첫 문자를 붙인 코드
                entry = prev + prev[0];
            }
            else {
                throw new Error(`Invalid compressed save: unknown code ${code}`);
            }
            result.push(entry);
            dictionary.set(dictSize++, prev + entry[0]);
            prev = entry;
        }
        return result.join('');
    }
}
//# sourceMappingURL=save_compressor.js.map