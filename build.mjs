// Build dist/: the bundled game, the page, and assets/ (music and voice, made by tools/assets.py and tools/voice.py).
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
await build({
  entryPoints: ['src/main.js'], bundle: true, minify: true, format: 'esm', target: 'es2022',
  outfile: 'dist/game.js', legalComments: 'eof', sourcemap: process.argv.includes('--map'), // eof: three.js' MIT notice stays in
});
for (const f of ['index.html', 'style.css']) cpSync(f, `dist/${f}`);
// without assets/ the game still runs, silent
if (existsSync('assets')) cpSync('assets', 'dist/assets', { recursive: true });
console.log(`dist/game.js ${(statSync('dist/game.js').size / 1024).toFixed(0)} KiB`);
