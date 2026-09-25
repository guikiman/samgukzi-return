#!/usr/bin/env node
/**
 * Tauri 데스크톱 빌드 사전 점검.
 * Rust 툴체인과 MSVC C++ 컴파일러를 직접 탐색한다.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const isWindows = process.platform === 'win32';
const cargoBin = join(homedir(), '.cargo', 'bin');
const toolPath = [cargoBin, process.env.PATH].filter(Boolean).join(';');
const pathEntries = new Set(
  toolPath.split(isWindows ? ';' : ':').map((entry) => entry.trim()).filter(Boolean),
);

const candidates = [
  'cargo',
  join(cargoBin, 'cargo.exe'),
  join(cargoBin, 'cargo'),
  'rustc',
  join(cargoBin, 'rustc.exe'),
  join(cargoBin, 'rustc'),
];
const found = new Set();
for (const candidate of candidates) {
  const result = spawnSync(candidate, ['--version'], {
    encoding: 'utf8',
    shell: isWindows,
    env: { ...process.env, PATH: [...pathEntries].join(';') },
  });
  if (!result.error && result.status === 0) {
    const name = candidate.endsWith('rustc') || candidate.endsWith('rustc.exe') ? 'rustc' : 'cargo';
    if (!found.has(name)) {
      found.add(name);
      const version = `${result.stdout || result.stderr}`.trim().split(/\r?\n/)[0];
      console.log(`OK ${name}: ${version}`);
    }
  }
}

const missing = ['cargo', 'rustc'].filter((name) => !found.has(name));
if (missing.length > 0) {
  console.error(`\nTauri desktop build is unavailable: missing ${missing.join(', ')}.`);
  if (isWindows) {
    console.error('Install Rust from https://rustup.rs/ and reopen the terminal.');
  } else {
    console.error('Install Rust from https://rustup.rs/ and the platform WebView development libraries.');
  }
  process.exit(1);
}

if (isWindows) {
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  const vsPaths = [];
  if (existsSync(vswhere)) {
    const result = spawnSync(vswhere, ['-all', '-products', '*', '-property', 'installationPath'], {
      encoding: 'utf8',
      shell: true,
    });
    if (!result.error && result.status === 0) {
      vsPaths.push(...(result.stdout || '').trim().split(/\r?\n/).filter(Boolean));
    }
  }
  vsPaths.push('C:\\BuildTools', 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools');

  const compilerFound = vsPaths.some((installationPath) => {
    const toolsRoot = join(installationPath, 'VC', 'Tools', 'MSVC');
    if (!existsSync(toolsRoot)) return false;
    for (const version of readdirSync(toolsRoot)) {
      const compiler = join(toolsRoot, version, 'bin', 'Hostx64', 'x64', 'cl.exe');
      if (existsSync(compiler)) {
        console.log(`OK MSVC compiler: ${compiler}`);
        return true;
      }
    }
    return false;
  });

  if (!compilerFound) {
    console.error('\nMSVC compiler not found. Install the Visual Studio C++ Desktop workload before running `npm run tauri:build`.');
    process.exit(1);
  }
}

console.log('\nTauri desktop prerequisites are ready.');
