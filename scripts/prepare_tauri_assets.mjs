import { cp, copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'tauri-assets');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of ['index.html', 'style.css', 'sw.js', 'sw-precache.json']) {
    await copyFile(join(root, file), join(output, file));
}
await cp(join(root, 'assets'), join(output, 'assets'), { recursive: true });
await cp(join(root, 'dist'), join(output, 'dist'), { recursive: true });
await cp(join(root, 'src', 'data'), join(output, 'src', 'data'), { recursive: true });

console.log(`[tauri-assets] ${output} 준비 완료`);
