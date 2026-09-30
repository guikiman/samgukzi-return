/**
 * Headless CLI Runner — 실제 GameEngine 기반 자동 게임 플레이
 *
 * 게임 유저 에이전트가 CLI에서 호출하여 자동으로 게임을 플레이하고
 * JSON 리포트를 출력한다.
 *
 * 사용법:
 *   npx tsx src/core/headless_cli_runner.ts --turns 100 --seed 42 --report report.json
 */

import { GameEngine } from './game_engine.js';
import { GameStore } from './game_store.js';
import type { GamePhase } from './types.js';

// ============================================================
// 타입 정의
// ============================================================

export interface HeadlessConfig {
  maxTurns: number;
  seed: number;
  logLevel: 'quiet' | 'summary' | 'verbose';
  reportPath: string;
  scenario: 'default' | 'aggressive' | 'peaceful';
}

export interface TurnReport {
  readonly turn: number;
  readonly phase: string;
  readonly officerCount: number;
  readonly factionCount: number;
  readonly cityCount: number;
  readonly commandCount: number;
  readonly errors: readonly string[];
  readonly durationMs: number;
}

export interface GameReport {
  readonly seed: number;
  readonly scenario: string;
  readonly turnsCompleted: number;
  readonly finalPhase: string;
  readonly officerCount: number;
  readonly factionCount: number;
  readonly cityCount: number;
  readonly totalCommands: number;
  readonly totalErrors: number;
  readonly turnReports: readonly TurnReport[];
  readonly durationMs: number;
  readonly issues: readonly string[];
}

// ============================================================
// 에러 타입
// ============================================================

class HeadlessRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HeadlessRunnerError';
  }
}

// ============================================================
// 게임 유저 에이전트
// ============================================================

export class HeadlessCliRunner {
  private config: HeadlessConfig;
  private engine: GameEngine | null = null;
  private turnReports: TurnReport[] = [];
  private issues: string[] = [];
  private startTime = 0;

  constructor(config: Partial<HeadlessConfig> = {}) {
    this.config = {
      maxTurns: config.maxTurns ?? 100,
      seed: config.seed ?? Date.now(),
      logLevel: config.logLevel ?? 'summary',
      reportPath: config.reportPath ?? '',
      scenario: config.scenario ?? 'default',
    };
  }

  async run(): Promise<GameReport> {
    this.startTime = Date.now();
    this.turnReports = [];
    this.issues = [];

    try {
      this.engine = this.createEngine();
      await this.playGame();
    } catch (err) {
      if (err instanceof Error) {
        this.issues.push(`Fatal: ${err.message}`);
      } else {
        this.issues.push('Fatal: unknown error');
      }
    }

    return this.buildReport();
  }

  private createEngine(): GameEngine {
    const store = GameStore.getInstance();
    const engine = new GameEngine(store);

    switch (this.config.scenario) {
      case 'aggressive':
        this.issues.push('Scenario: aggressive (전쟁 중심)');
        break;
      case 'peaceful':
        this.issues.push('Scenario: peaceful (내정 중심)');
        break;
      default:
        this.issues.push('Scenario: default (균형)');
        break;
    }

    return engine;
  }

  private async playGame(): Promise<void> {
    if (!this.engine) throw new HeadlessRunnerError('Engine not created');

    for (let turn = 1; turn <= this.config.maxTurns; turn++) {
      const turnStart = Date.now();
      const errors: string[] = [];

      try {
        await this.engine.executeTurn();
      } catch (err) {
        if (err instanceof Error) {
          errors.push(err.message);
          this.issues.push(`Turn ${turn}: ${err.message}`);
        }
      }

      const report = this.collectTurnReport(turn, errors, Date.now() - turnStart);
      this.turnReports.push(report);

      if (this.config.logLevel === 'verbose') {
        console.log(`[Turn ${turn}] ${report.phase} | officers=${report.officerCount} | cmds=${report.commandCount} | ${report.durationMs}ms`);
      } else if (this.config.logLevel === 'summary' && turn % 10 === 0) {
        console.log(`Progress: ${turn}/${this.config.maxTurns} turns`);
      }
    }
  }

  private collectTurnReport(turn: number, errors: readonly string[], durationMs: number): TurnReport {
    if (!this.engine) {
      return { turn, phase: 'UNKNOWN', officerCount: 0, factionCount: 0, cityCount: 0, commandCount: 0, errors, durationMs };
    }

    const store = this.engine['store'] as GameStore;

    return {
      turn,
      phase: this.engine.getCurrentPhase(),
      officerCount: store.getAllOfficers().length,
      factionCount: store.getAllFactions().length,
      cityCount: store.getAllCities().length,
      commandCount: this.engine.getPendingCommandCount(),
      errors,
      durationMs,
    };
  }

  private buildReport(): GameReport {
    const totalDuration = Date.now() - this.startTime;
    const lastReport = this.turnReports[this.turnReports.length - 1];

    return {
      seed: this.config.seed,
      scenario: this.config.scenario,
      turnsCompleted: this.turnReports.length,
      finalPhase: lastReport?.phase ?? 'UNKNOWN',
      officerCount: lastReport?.officerCount ?? 0,
      factionCount: lastReport?.factionCount ?? 0,
      cityCount: lastReport?.cityCount ?? 0,
      totalCommands: this.turnReports.reduce((sum, r) => sum + r.commandCount, 0),
      totalErrors: this.turnReports.reduce((sum, r) => sum + r.errors.length, 0),
      turnReports: [...this.turnReports],
      durationMs: totalDuration,
      issues: [...this.issues],
    };
  }
}

// ============================================================
// CLI 엔트리 포인트
// ============================================================

declare const process: { argv: readonly string[]; exit(code: number): void };

function parseArgs(args: readonly string[]): Partial<HeadlessConfig> {
  const config: Partial<HeadlessConfig> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) continue;

    if (arg === '--turns' && i + 1 < args.length) {
      const val = args[++i];
      if (val) config.maxTurns = parseInt(val, 10);
    } else if (arg === '--seed' && i + 1 < args.length) {
      const val = args[++i];
      if (val) config.seed = parseInt(val, 10);
    } else if (arg === '--report' && i + 1 < args.length) {
      const val = args[++i];
      if (val) config.reportPath = val;
    } else if (arg === '--log' && i + 1 < args.length) {
      const val = args[++i];
      if (val === 'quiet' || val === 'summary' || val === 'verbose') {
        config.logLevel = val;
      }
    } else if (arg === '--scenario' && i + 1 < args.length) {
      const val = args[++i];
      if (val === 'default' || val === 'aggressive' || val === 'peaceful') {
        config.scenario = val;
      }
    }
  }

  return config;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const runner = new HeadlessCliRunner(config);
  const report = await runner.run();

  console.log('\n=== Game Report ===');
  console.log(`Seed: ${report.seed}`);
  console.log(`Scenario: ${report.scenario}`);
  console.log(`Turns: ${report.turnsCompleted}`);
  console.log(`Final Phase: ${report.finalPhase}`);
  console.log(`Officers: ${report.officerCount}`);
  console.log(`Factions: ${report.factionCount}`);
  console.log(`Cities: ${report.cityCount}`);
  console.log(`Total Commands: ${report.totalCommands}`);
  console.log(`Total Errors: ${report.totalErrors}`);
  console.log(`Duration: ${report.durationMs}ms`);

  if (report.issues.length > 0) {
    console.log('\n=== Issues ===');
    for (const issue of report.issues) {
      console.log(`  - ${issue}`);
    }
  }

  if (config.reportPath) {
    const { writeFileSync } = await import('node:fs' as never) as unknown as {
      writeFileSync: (path: string, data: string) => void;
    };
    writeFileSync(config.reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport saved to: ${config.reportPath}`);
  }
}

// no-excuse-ok: catch
main().catch((err: unknown) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
