// Собирает автономную программу: dist/LiftingFrame.exe (Windows x64) и dist/lifting-frame (Linux x64).
// Запуск из корня репозитория: bun run contrib/lifting-frame/desktop/build.ts
import { $ } from 'bun';
import path from 'node:path';

const dir = import.meta.dir;
const out = path.join(dir, 'dist');
const entry = path.join(dir, 'main.ts');

await $`bun build --compile --minify --target=bun-windows-x64 ${entry} --outfile ${path.join(out, 'LiftingFrame.exe')}`;
await $`bun build --compile --minify --target=bun-linux-x64 ${entry} --outfile ${path.join(out, 'lifting-frame')}`;
console.log(`Готово: ${out}`);
