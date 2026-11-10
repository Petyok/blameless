// Static server for dist/ (the game needs http: for audio analysis; file:// would mute the analyser).
//   node serve.mjs [port=4173] [dir=dist]      Supports Range, which looping music needs.
import http from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ogg': 'audio/ogg', '.json': 'application/json', '.jpg': 'image/jpeg' };

export function serve(port = 4173, dir = 'dist', host = '127.0.0.1') {
  const root = resolve(dir);
  const server = http.createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    const file = join(root, path.endsWith('/') ? `${path}index.html` : path);
    let size;
    try {
      if (!file.startsWith(root)) throw new Error('outside root');
      const s = statSync(file);
      if (!s.isFile()) throw new Error('not a file');
      size = s.size;
    } catch {
      res.writeHead(404).end('not found');
      return;
    }
    const head = { 'content-type': MIME[extname(file)] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      const start = m[1] ? +m[1] : Math.max(0, size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
      if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }).end(); return; }
      res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { ...head, 'content-length': size });
      createReadStream(file).pipe(res);
    }
  });
  return new Promise((ok, fail) => server.once('error', fail).listen(port, host, () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.argv[2] || 4173;
  await serve(port, process.argv[3] || join(fileURLToPath(new URL('.', import.meta.url)), 'dist'));
  console.log(`BLAMELESS on http://127.0.0.1:${port}/`);
}
