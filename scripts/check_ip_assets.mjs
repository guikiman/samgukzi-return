/**
 * IP 게이트 — 파생작 자산이 커밋/푸시되는 것을 막는다.
 *
 * 배경
 * ----
 * assets/china-national-map.png 은 상용 전략 게임의 파생 지도
 * 파생 지도였다. 렌더러에서 제거하고 untrack 했고(filter-repo 로 히스토리에서도 제거),
 * 지금은 Natural Earth 퍼블릭 도메인 데이터로 만든 map-china-4096.webp 가 그 자리를
 * 대신한다. 이 스크립트는 그것이 다시 들어오는 것을 경로명과 해시 양쪽으로 막는다.
 *
 * 경로 검사만으로는 이름만 바뀐 복사본을 못 잡는다. 그래서 알려진 blob 의 sha256 도
 * 함께 대조한다.
 *
 * 사용
 * ----
 *   node scripts/check_ip_assets.mjs               # refs/origin 대상 미푸시 커밋
 *   node scripts/check_ip_assets.mjs --all         # 모든 로컬 ref 전체
 *   node scripts/check_ip_assets.mjs <ref>...      # 지정한 ref 의 전체 히스토리
 *   node scripts/check_ip_assets.mjs --provenance  # 자산 대장만 검사 (히스토리 스캔 없음)
 *
 * pre-push 훅에서 stdin 으로 넘어오는 ref 를 그대로 받는다.
 * 종료 코드 0 = 통과, 1 = 위반.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DENIED_PATHS = [
    // 상용 전략 게임 파생 지도. 렌더링 경로에서도 서비스워커 캐시에서도 제거됨.
    'assets/china-national-map.png',
];

/**
 * 차단 대상. 경로는 그대로 두면 되지만, 이름만 바꿔서 다시 넣는 경우를 위해
 * git blob 객체 id(sha1) 로도 막는다.
 *
 * 주의: `git ls-tree` 가 주는 것은 sha256 이 아니라 **git blob id(sha1)** 다.
 * 아래 값은 파일 내용의 sha256 이 아니다 — `git rev-parse <commit>:<path>` 로 얻은
 * blob id 다. 둘을 헷갈리면 이름만 바꾼 복사본을 못 잡는다.
 */
const DENIED_BLOB_IDS = new Set([
    // china-national-map.png 원본 (4,054,452 bytes, 1536x1024)
    // sha256(내용) = 02686e0add63482a08f90f677c8ad3404ba4d7c310d67d96c34e17aa9b19e451
    'cf6ac646a47fbd53a5fdada551816be0e2e34b25',
]);

function git(args, input) {
    return execFileSync('git', args, { encoding: 'utf8', input, maxBuffer: 1 << 28 });
}

/** 표준 입력에서 pre-push 훅이 넘겨준 "<local ref> <local sha> <remote ref> <remote sha>" 줄들 */
function readHookInput() {
    let raw = '';
    try {
        raw = readFileSync(0, 'utf8');
    } catch {
        return [];
    }
    return raw.split('\n').filter(Boolean).map((line) => {
        const [localRef, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
        return { localRef, localSha, remoteRef, remoteSha };
    });
}

/** 훅 입력에 없으면 origin 대비 미푸시 커밋을 검사한다. */
function targetCommits() {
    const hook = readHookInput();
    if (hook.length > 0) {
        const shas = new Set();
        for (const { localRef, localSha, remoteSha } of hook) {
            if (localSha === '0000000000000000000000000000000000000000') continue; // 삭제
            if (localRef && localRef.startsWith('refs/tags/')) {
                shas.add(localSha);
                continue;
            }
            // 실제로 전송될 객체 = 로컬에 있고 원격에 없는 커밋
            const range = remoteSha === '0000000000000000000000000000000000000000'
                ? localSha
                : `${remoteSha}..${localSha}`;
            for (const c of git(['rev-list', range]).split('\n')) if (c) shas.add(c);
        }
        return [...shas];
    }
    return git(['rev-list', 'origin/master..HEAD']).split('\n').filter(Boolean);
}

const REPO_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');
const PROVENANCE_PATH = resolvePath(REPO_ROOT, 'assets/PROVENANCE.json');

/** 출처 대장이 관리하는 경로. 이 아래 바이너리 파일은 전부 등록돼 있어야 한다. */
const MANAGED_PREFIXES = ['assets/', 'src-tauri/icons/'];
const BINARY_EXT = /\.(png|jpe?g|webp|gif|svg|ttf|otf|woff2?|eot|mp3|wav|ogg|mp4|webm|avi|mov|pdf|xlsx|docx|pptx|psd|blend)$/i;

/**
 * 자산 대장 검사 — "한 치도 없다"를 실제로 강제하는 층.
 *
 * [왜 denylist 만으로는 부족한가]
 * 아래의 DENIED_PATHS 는 이미 들어온 자산 1건과 그 blob id 하나만 막는다.
 * 새 파생작이 다른 이름으로 추가되면 그대로 통과한다. 실제로 이 프로젝트는
 * 그랬다 — china-national-map.png 를 지운 뒤 같은 날 AI 원화 이미지가
 * 출처 기록 없이 커밋되었고, 아무도 알 수 없었다.
 *
 * 그래서 규칙을 뒤집는다. **등록되지 않은 자산은 위반**이다. 대장에 경로와
 * 근거가 없는 바이너리는 통과할 수 없고, sha256 이 어긋나면 파일이 바뀐 것이니
 * 라이선스를 다시 확인하라는 신호가 된다.
 */
function scanProvenance() {
    const violations = [];

    if (!existsSync(PROVENANCE_PATH)) {
        console.error(`[ip-gate] 자산 대장이 없다: ${PROVENANCE_PATH}`);
        console.error('        바이너리 자산을 추적하려면 assets/PROVENANCE.json 이 반드시 있어야 한다.');
        return 1;
    }

    let registry;
    try {
        registry = JSON.parse(readFileSync(PROVENANCE_PATH, 'utf8'));
    } catch (err) {
        console.error(`[ip-gate] 자산 대장을 읽을 수 없다: ${err.message}`);
        return 1;
    }

    const entries = new Map();
    for (const asset of registry.assets ?? []) {
        if (!asset || typeof asset.path !== 'string') {
            violations.push('대장 항목에 path 가 없다');
            continue;
        }
        if (entries.has(asset.path)) violations.push(`대장에 같은 경로가 두 번 있다: ${asset.path}`);
        entries.set(asset.path, asset);
    }

    const tracked = git(['ls-files']).split('\n').filter(Boolean);
    const seen = new Set();
    for (const path of tracked) {
        if (!MANAGED_PREFIXES.some(prefix => path.startsWith(prefix))) continue;
        if (!BINARY_EXT.test(path)) continue;
        seen.add(path);

        const entry = entries.get(path);
        if (!entry) {
            violations.push(`미등록 자산: ${path}\n    assets/PROVENANCE.json 에 출처와 라이선스를 기록하라.`);
            continue;
        }
        const license = String(entry.license ?? '').trim();
        if (!license || license.toUpperCase().includes('UNVERIFIED')) {
            violations.push(`근거 미확인 자산: ${path}\n    license = ${license || '(비어 있음)'}\n    출처를 확인해 대장을 고치거나, 파생작이면 배포하지 마라.`);
        }
        // 등록된 파일의 내용이 바뀌었는지 확인한다 — 라이선스 검토 없이 조용한 교체를 막는다.
        const full = resolvePath(REPO_ROOT, path);
        if (existsSync(full) && entry.sha256) {
            const actual = createHash('sha256').update(readFileSync(full)).digest('hex');
            if (actual !== entry.sha256) {
                violations.push(`대장과 불일치: ${path}\n    대장 ${entry.sha256}\n    실제 ${actual}\n    파일이 바뀌었으니 라이선스를 다시 확인하고 대장을 갱신하라.`);
            }
        }
    }

    // 대장에 있지만 더 이상 존재하지 않는 항목 — 대장이 썩지 않게 한다.
    for (const path of entries.keys()) {
        if (!seen.has(path)) violations.push(`대기에만 있는 자산: ${path}\n    파일이 없으므로 항목을 지워라.`);
    }

    if (violations.length === 0) {
        console.log(`[ip-gate] 자산 대장: ${seen.size}개 바이너리 전부 출처 확인됨. 통과.`);
        return 0;
    }
    console.error(`[ip-gate] 자산 대장 위반 ${violations.length}건.`);
    for (const v of violations) console.error(`  - ${v}`);
    return 1;
}

function scan(commits, scope) {
    const violations = [];
    const seenPaths = new Set();
    const seenShas = new Set();

    for (const commit of commits) {
        const tree = git(['ls-tree', '-r', commit]);
        for (const line of tree.split('\n')) {
            if (!line) continue;
            const tab = line.indexOf('\t');
            const meta = line.slice(0, tab).split(/\s+/);
            const path = line.slice(tab + 1);
            const sha = meta[2];

            if (DENIED_PATHS.includes(path)) {
                if (!seenPaths.has(path)) {
                    seenPaths.add(path);
                    violations.push(`경로 위반: ${path}\n    커밋 ${commit.slice(0, 8)}`);
                }
                continue;
            }
            if (DENIED_BLOB_IDS.has(sha) && !seenShas.has(sha)) {
                seenShas.add(sha);
                violations.push(`blob 위반: 차단된 copyrighted blob 이 이름만 바뀌어 들어옴\n    커밋 ${commit.slice(0, 8)}\n    경로 ${path}\n    blob ${sha}`);
            }
        }
    }

    if (commits.length === 0) {
        console.log(`[ip-gate] ${scope}: 검사할 커밋 없음. 통과.`);
        return 0;
    }
    if (violations.length === 0) {
        console.log(`[ip-gate] ${scope}: ${commits.length}커밋 스캔, 위반 0건. 통과.`);
        return 0;
    }
    console.error(`[ip-gate] ${scope}: ${commits.length}커밋 스캔, 위반 ${violations.length}건.`);
    for (const v of violations) console.error(`  - ${v}`);
    console.error('\n이 자산은 파생 작품이라 배포할 수 없습니다.');
    console.error('차단된 커밋이 이미 push됐다면 filter-repo 로 히스토리에서 제거해야 합니다.');
    return 1;
}

const argv = process.argv.slice(2);
if (argv.includes('--provenance')) {
    // 자산 대장은 현재 워킹트리에 대한 검사라 커밋 스캔과 분리한다.
    // pre-push 는 둘 다 돌리고, CI 는 --all 과 함께 돌린다.
    process.exit(scanProvenance());
} else if (argv.includes('--all')) {
    const refs = git(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags', 'refs/remotes'])
        .split('\n').filter(Boolean);
    const commits = new Set();
    for (const ref of refs) for (const c of git(['rev-list', ref]).split('\n')) if (c) commits.add(c);
    process.exit(scan([...commits], '모든 로컬 ref'));
} else if (argv.length > 0) {
    const commits = new Set();
    for (const ref of argv) for (const c of git(['rev-list', ref]).split('\n')) if (c) commits.add(c);
    process.exit(scan([...commits], argv.join(', ')));
} else {
    process.exit(scan(targetCommits(), '푸시 대상'));
}
