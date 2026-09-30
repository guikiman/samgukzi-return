/**
 * vitest globalSetup — 스위트 전체에 걸친 `src/data/` 변조 가드.
 *
 * `tests/officer_ui_wiring.test.ts` 안에서만 before/after 지문을 비교하면
 * **그 테스트 파일이** 변조한 것만 잡는다. vitest 는 테스트 파일을 별도
 * 워커로 격리하므로, 다른 파일이 데이터를 망가뜨려도 그 파일의 afterAll 은
 * 자기 실행 전 상태를 기준으로 비교하므로 조용히 통과한다.
 *
 * 그래서 스위트 시작/종료 지점을 한 곳에서 잡는 globalSetup 을 쓴다.
 * teardown 이 반환되면 전체 실행이 실패하므로, "누가" 를 특정하지 않아도
 * 변조 자체가 suites 를 깨뜨린다. 실패 메시지에 바뀐 파일 목록을 남긴다.
 *
 * 커밋 타이밍과 무관하므로 개발 중 미커밋 데이터 편집과 충돌하지 않는다.
 */
import { fingerprintDataDir, diffFingerprints } from './data_fingerprint';

export default function setup(): () => void {
    const repoRoot = process.cwd();
    const before = fingerprintDataDir(repoRoot);

    return () => {
        const after = fingerprintDataDir(repoRoot);
        const changed = diffFingerprints(before, after);
        if (changed.length === 0) return;
        const message = '테스트 실행 중 src/data/ 의 내용이 바뀌었다 — 어떤 테스트가 시나리오 데이터를 변조했다:\n  '
            + changed.join('\n  ');
        // teardown 에서 throw 하면 vitest 가 이를 "error during close" 로만
        // 찍고 **종료 코드를 0 으로 돌려보낸다.** 실제로 측정했다 — 그래서
        // 명시적으로 exitCode 를 1 로 밀어붙여야 CI 가 red 가 된다.
        process.exitCode = 1;
        process.stderr.write(`\n[data-guard] ${message}\n`);
        throw new Error(message);
    };
}
