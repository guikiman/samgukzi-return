import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        // 스위트 전체에 걸친 src/data/ 변조 가드 — 어떤 테스트 파일이든
        // 시나리오 데이터를 건드리면 전체 실행이 실패한다.
        globalSetup: ['tests/support/data_guard_setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov', 'html'],
            include: ['src/core/*.ts'],
            exclude: ['src/core/state_manager.py'],
            thresholds: {
                lines: 80,
                functions: 80,
                branches: 80,
                statements: 80,
            },
        },
    },
});
