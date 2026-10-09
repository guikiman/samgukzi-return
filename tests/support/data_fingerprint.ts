/**
 * `src/data/` 내용 지문 — 시나리오 데이터가 변조됐는지 검사하기 위한 공용 헬퍼.
 *
 * [왜 git 을 쓰지 않는가]
 * 이전의 데이터 불변 검사는 `git status --porcelain -- src/data/` 와
 * `git diff --stat HEAD -- ...` 결과를 비교했다. 하지만 그것은 **소스가 아니라
 * 커밋 상태**를 검사한다. 에이전트가 정당한 데이터 수정을 하고 아직 커밋하지
 * 않은 동안에만, 다른 테스트가 전부 green 인데 이 검사 하나만 red 가 됐다.
 * 그 실패는 버그가 아니라 커밋 타이밍을 가리키므로 실패로 읽을 이유가 없다.
 *
 * 여기서 검사하는 불변식은 "테스트 실행이 데이터를 변조하지 않는다" 다.
 * 커밋 여부·HEAD·워킹트리 상태와 완전히 무관하므로 언제나 같은 결과를 낸다.
 * 개발 중인 미커밋 데이터 편집은 정상적으로 허용된다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';

/** `src/data/` 아래 모든 파일의 "상대경로 → sha256" 지문. */
export function fingerprintDataDir(repoRoot: string): Map<string, string> {
    const root = resolve(repoRoot, 'src/data');
    const out = new Map<string, string>();
    const walk = (dir: string): void => {
        for (const entry of readdirSync(dir).sort()) {
            const full = join(dir, entry);
            if (statSync(full).isDirectory()) {
                walk(full);
            } else {
                // 경로를 '/' 로 정규화한다 — Windows 와 POSIX 의 결과가 달라지면
                // "같은 파일"인데도 다른 키로 잡혀 오탐이 난다.
                const rel = relative(root, full).split('\\').join('/');
                out.set(rel, createHash('sha256').update(readFileSync(full)).digest('hex'));
            }
        }
    };
    walk(root);
    return out;
}

/** 두 지문의 차이를 사람이 읽을 수 있는 목록으로. 추가/삭제/변경을 모두 살핀다. */
export function diffFingerprints(before: Map<string, string>, after: Map<string, string>): string[] {
    const changed: string[] = [];
    for (const [file, hash] of after) {
        const prev = before.get(file);
        if (prev === undefined) changed.push(`추가됨: ${file}`);
        else if (prev !== hash) changed.push(`변경됨: ${file}`);
    }
    for (const file of before.keys()) {
        if (!after.has(file)) changed.push(`삭제됨: ${file}`);
    }
    return changed.sort();
}
