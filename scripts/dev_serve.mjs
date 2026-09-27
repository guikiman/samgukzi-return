/**
 * 개발용 정적 서버 — 대화를 고쳐 보고 즉시 확인하기 위한 것 [신규]
 *
 * 왜 이게 필요한가:
 * 이 프로젝트는 Vite 가 없다. 빌드가 `tsc` -> dist/ 이고,
 * index.html 은 루트의 style.css 와 dist/src/main.js 를 직접 참조한다.
 * 그래서 개발 중에는 (1) tsc --watch 로 dist 를 계속 갱신하고
 * (2) 루트를 그대로 서빙하면서 (3) 파일이 바뀌면 브라우저를 알아게 하면 된다.
 *
 * 사용: node scripts/dev_serve.mjs [포트]
 * 열 곳:  http://127.0.0.1:8181/
 */
import { createServer } from 'node:http';
import { readFile, stat, watch } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.argv[2] ?? 8181);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
};

/** 자동 새로고침을 받을 연결들. */
const clients = new Set();

function broadcast() {
    for (const res of clients) {
        try { res.write('data: reload\n\n'); } catch { clients.delete(res); }
    }
}

const server = createServer(async (req, res) => {
    const url = decodeURIComponent((req.url ?? '/').split('?')[0]);

    // 자동 새로고침 채널
    if (url === '/__reload') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-store',
            Connection: 'keep-alive',
        });
        res.write('retry: 500\n\n');
        clients.add(res);
        req.on('close', () => clients.delete(res));
        return;
    }

    let rel = url === '/' ? '/index.html' : url;
    // ../ 로 루트 밖을 못 읽게 한다.
    const safe = normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const file = join(ROOT, safe);

    try {
        const info = await stat(file);
        if (!info.isFile()) throw new Error('not a file');
        const body = await readFile(file);
        res.writeHead(200, {
            // 개발 중에는 브라우저 캐시를 믿으면 안 된다.
            'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
            'Cache-Control': 'no-store, must-revalidate',
        });
        res.end(body);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 ' + safe);
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[dev] http://127.0.0.1:${PORT}/  (루트 ${ROOT})`);
    console.log('[dev] 파일을 고치고 저장하면 브라우저가 자동으로 다시 돕니다.');
});

/**
 * 감시 대상. tsc 가 dist 를 갈아끼우는 걸 감지하면 새로고침한다.
 * fs.watch 는 rename 을 놓치므로 dist 폴더 자체를 함께 본다.
 */
let pending = null;
function onChange() {
    // tsc 는 여러 파일을 한 번에 쓴다. 잦아든다.
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
        pending = null;
        broadcast();
    }, 250);
}

for (const dir of ['.', './dist/src']) {
    try {
        watch(dir, { recursive: false }, (_event, filename) => {
            if (!filename) return onChange();
            if (/^(index\.html|style\.css|main\.(js|map))$/.test(String(filename))) onChange();
            else if (String(filename).includes('main.js')) onChange();
        });
    } catch {
        // 아직 없는 폴더는 무시한다. 첫 빌드 뒤에 dist 가 생긴다.
    }
}
