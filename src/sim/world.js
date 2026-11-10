// Grid world: ASCII maps, circle collision, 3D raycast against the block volumes, BFS flow field.
// Pure (no DOM, no three.js).
import { CELL, RACK_H, WALL_H, STEP } from './config.js';

// '#': wall, 'R': rack (standable, RACK_H tall), '.': floor, 'P': player start,
// 'B': boss, 'Y': dependency pylon (phase 1), 'y': pylon (phase 3)
const B = '##########################';
const O = '#........................#';
export const MAPS = [
  [B, O, O, O,
    '#..RRRR..RRRR..RRRR..RR..#', O, O, O, O,
    '#..RR..RRRR....RRRR..RR..#', O, O, O,
    '#............P...........#', O, O,
    '#..RR..RRRR....RRRR..RR..#', O, O, O, O,
    '#..RR..RRRR..RRRR..RRRR..#', O, O, O, B],
  [B, O, O, O,
    '#...RR.....RR.....RR.....#',
    '#...RR.....RR.....RR.....#', O, O,
    '#.RRR................RRR.#', O,
    '#.......RR......RR.......#',
    '#.......RR......RR.......#', O,
    '#............P...........#',
    '#.......RR......RR.......#',
    '#.......RR......RR.......#', O,
    '#.RRR................RRR.#', O, O,
    '#.....RR.....RR.....RR...#',
    '#.....RR.....RR.....RR...#', O, O, O, B],
  [B, O, O, O, O,
    '#....RRRR........RRRR....#',
    '#....R..............R....#',
    '#....R..............R....#', O, O,
    '#.........RR..RR.........#',
    '#.........R....R.........#', O,
    '#............P...........#',
    '#.........R....R.........#',
    '#.........RR..RR.........#', O, O,
    '#....R..............R....#',
    '#....R..............R....#',
    '#....RRRR........RRRR....#', O, O, O, O, B],
  [B, O, O, O,
    '#...Y........y.......Y...#', O, O, O,
    '#.......RR......RR.......#', O, O, O,
    '#............B...........#', O, O, O, O,
    '#.......RR......RR.......#', O, O, O,
    '#...Y.......y........Y...#',
    '#............P...........#', O, O, B],
];

const INF = 32767;

export function makeWorld(mapIndex) {
  const rows = MAPS[mapIndex];
  const h = rows.length, w = rows[0].length;
  const W = {
    map: mapIndex, w, h, ox: -w * CELL / 2, oz: -h * CELL / 2,
    kind: new Uint8Array(w * h), top: new Float64Array(w * h), dist: new Int16Array(w * h).fill(INF),
    free: [], start: { x: 0, z: 0 }, boss: null, pylons: [], pylons2: [], queue: new Int32Array(w * h),
  };
  for (let cz = 0; cz < h; cz++) {
    for (let cx = 0; cx < w; cx++) {
      const ch = rows[cz][cx], i = cz * w + cx;
      const x = W.ox + (cx + 0.5) * CELL, z = W.oz + (cz + 0.5) * CELL;
      if (ch === '#') { W.kind[i] = 2; W.top[i] = WALL_H; continue; }
      if (ch === 'R') { W.kind[i] = 1; W.top[i] = RACK_H; continue; }
      W.free.push(i);
      if (ch === 'P') W.start = { x, z };
      else if (ch === 'B') W.boss = { x, z };
      else if (ch === 'Y') W.pylons.push({ x, z });
      else if (ch === 'y') W.pylons2.push({ x, z });
    }
  }
  return W;
}

export const cellOf = (W, x, z) => {
  const cx = Math.floor((x - W.ox) / CELL), cz = Math.floor((z - W.oz) / CELL);
  return cx < 0 || cz < 0 || cx >= W.w || cz >= W.h ? -1 : cz * W.w + cx;
};
export const cellX = (W, i) => W.ox + ((i % W.w) + 0.5) * CELL;
export const cellZ = (W, i) => W.oz + (((i / W.w) | 0) + 0.5) * CELL;
const topAt = (W, cx, cz) => (cx < 0 || cz < 0 || cx >= W.w || cz >= W.h ? WALL_H : W.top[cz * W.w + cx]);

/** Highest surface the circle can stand on at feet height feetY. */
export function groundAt(W, x, z, r, feetY) {
  const c0 = Math.floor((x - r - W.ox) / CELL), c1 = Math.floor((x + r - W.ox) / CELL);
  const r0 = Math.floor((z - r - W.oz) / CELL), r1 = Math.floor((z + r - W.oz) / CELL);
  let g = 0;
  for (let cz = r0; cz <= r1; cz++) {
    for (let cx = c0; cx <= c1; cx++) {
      const t = topAt(W, cx, cz);
      if (t > g && t <= feetY + STEP) g = t;
    }
  }
  return g;
}

/**
 * Slide a circle (o.x, o.z) by (dx, dz) through the grid. Cells whose top is more than STEP above
 * feetY block. Returns true when it touched something.
 */
export function moveCircle(W, o, dx, dz, r, feetY) {
  let hit = false;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / (r * 0.8)));
  const sx = dx / steps, sz = dz / steps, lim = feetY + STEP;
  for (let s = 0; s < steps; s++) {
    o.x += sx; o.z += sz;
    const c0 = Math.floor((o.x - r - W.ox) / CELL), c1 = Math.floor((o.x + r - W.ox) / CELL);
    const r0 = Math.floor((o.z - r - W.oz) / CELL), r1 = Math.floor((o.z + r - W.oz) / CELL);
    for (let cz = r0; cz <= r1; cz++) {
      for (let cx = c0; cx <= c1; cx++) {
        if (topAt(W, cx, cz) <= lim) continue;
        const minx = W.ox + cx * CELL, minz = W.oz + cz * CELL;
        const nx = o.x < minx ? minx : o.x > minx + CELL ? minx + CELL : o.x;
        const nz = o.z < minz ? minz : o.z > minz + CELL ? minz + CELL : o.z;
        const ex = o.x - nx, ez = o.z - nz, d2 = ex * ex + ez * ez;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 1e-10) {
          const d = Math.sqrt(d2), k = (r - d) / d;
          o.x += ex * k; o.z += ez * k;
        } else {
          // centre inside the cell (teleport or huge step): leave through the nearest open face
          const opts = [
            [o.x - minx, -1, 0], [minx + CELL - o.x, 1, 0], [o.z - minz, 0, -1], [minz + CELL - o.z, 0, 1],
          ].filter((f) => topAt(W, cx + f[1], cz + f[2]) <= lim).sort((a, b) => a[0] - b[0]);
          const f = opts[0];
          if (f) {
            if (f[1]) o.x = f[1] < 0 ? minx - r : minx + CELL + r;
            else o.z = f[2] < 0 ? minz - r : minz + CELL + r;
          }
        }
      }
    }
  }
  return hit;
}

/**
 * Ray against floor (y=0) and block volumes. Returns the hit distance (maxT when nothing is hit);
 * out.hit: 0 none, 1 floor, 2 side, 3 top; out.nx/ny/nz: surface normal.
 */
export function raycast(W, ox, oy, oz, dx, dy, dz, maxT, out) {
  let cx = Math.floor((ox - W.ox) / CELL), cz = Math.floor((oz - W.oz) / CELL);
  const stepX = dx > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const ax = Math.abs(dx), az = Math.abs(dz);
  const tDX = ax > 1e-9 ? CELL / ax : Infinity, tDZ = az > 1e-9 ? CELL / az : Infinity;
  let tMaxX = ax > 1e-9 ? (dx > 0 ? W.ox + (cx + 1) * CELL - ox : ox - (W.ox + cx * CELL)) / ax : Infinity;
  let tMaxZ = az > 1e-9 ? (dz > 0 ? W.oz + (cz + 1) * CELL - oz : oz - (W.oz + cz * CELL)) / az : Infinity;
  const tFloor = dy < -1e-9 ? -oy / dy : Infinity;
  let tEnter = 0, nx = 0, nz = 0;
  for (let i = 0; i < 256; i++) {
    const top = topAt(W, cx, cz), tExit = tMaxX < tMaxZ ? tMaxX : tMaxZ;
    if (top > 0) {
      if (oy + dy * tEnter < top) {
        if (tEnter > maxT) break;
        if (out) { out.hit = 2; out.nx = nx; out.ny = 0; out.nz = nz; }
        return tEnter;
      }
      if (dy < 0) {
        const tTop = (top - oy) / dy;
        if (tTop >= tEnter && tTop <= tExit) {
          if (tTop > maxT) break;
          if (out) { out.hit = 3; out.nx = 0; out.ny = 1; out.nz = 0; }
          return tTop;
        }
      }
    } else if (tFloor <= tExit) {
      if (tFloor > maxT) break;
      if (out) { out.hit = 1; out.nx = 0; out.ny = 1; out.nz = 0; }
      return tFloor;
    }
    if (tExit >= maxT) break;
    if (tMaxX < tMaxZ) { cx += stepX; tEnter = tMaxX; tMaxX += tDX; nx = -stepX; nz = 0; }
    else { cz += stepZ; tEnter = tMaxZ; tMaxZ += tDZ; nx = 0; nz = -stepZ; }
  }
  if (out) out.hit = 0;
  return maxT;
}

/** Line of sight between two points at height y (blocked by anything taller than y). */
export function los(W, x0, z0, x1, z1, y = 1.2) {
  const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  return raycast(W, x0, y, z0, dx / d, 0, dz / d, d, null) >= d - 1e-6;
}

const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** BFS distances (in cells) from the floor cell nearest to (px, pz). */
export function computeFlow(W, px, pz) {
  const { w, h, kind, dist, queue } = W;
  dist.fill(INF);
  let start = cellOf(W, px, pz);
  if (start < 0 || kind[start] !== 0) {
    let best = -1, bd = Infinity;
    for (const i of W.free) {
      const d = (cellX(W, i) - px) ** 2 + (cellZ(W, i) - pz) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    start = best;
  }
  let head = 0, tail = 0;
  dist[start] = 0; queue[tail++] = start;
  while (head < tail) {
    const i = queue[head++], d = dist[i] + 1, cx = i % w, cz = (i / w) | 0;
    for (let k = 0; k < 4; k++) {
      const x = cx + N8[k][0], z = cz + N8[k][1];
      if (x < 0 || z < 0 || x >= w || z >= h) continue;
      const j = z * w + x;
      if (kind[j] !== 0 || dist[j] <= d) continue;
      dist[j] = d; queue[tail++] = j;
    }
  }
  W.flowCell = start;
}

/** Unit direction (out.x, out.z) that walks the flow field from (x, z) towards (px, pz). */
export function flowDir(W, x, z, px, pz, out) {
  const c = cellOf(W, x, z);
  let tx = px, tz = pz;
  if (c >= 0 && W.dist[c] !== INF && W.dist[c] > 0) {
    const cx = c % W.w, cz = (c / W.w) | 0;
    const d0 = W.dist[c];
    let bi = -1, bscore = Infinity;
    for (let k = 0; k < 8; k++) {
      const x2 = cx + N8[k][0], z2 = cz + N8[k][1];
      if (x2 < 0 || z2 < 0 || x2 >= W.w || z2 >= W.h) continue;
      const j = z2 * W.w + x2, d = W.dist[j];
      if (d >= d0) continue; // only strictly downhill (INF is never downhill)
      // no corner cutting on diagonals
      if (k >= 4 && (W.kind[cz * W.w + x2] !== 0 || W.kind[z2 * W.w + cx] !== 0)) continue;
      const jx = cellX(W, j), jz = cellZ(W, j);
      const score = d * 1000 + Math.hypot(jx - px, jz - pz);
      if (score < bscore) { bi = j; bscore = score; }
    }
    if (bi >= 0) { tx = cellX(W, bi); tz = cellZ(W, bi); }
  }
  const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
  if (d < 1e-6) { out.x = 0; out.z = 0; } else { out.x = dx / d; out.z = dz / d; }
  return out;
}

/** A reachable floor cell centre between minD and maxD metres from (px, pz). */
export function randomFreeCell(W, rng, px, pz, minD, maxD, out) {
  let fx = W.start.x, fz = W.start.z;
  for (let tries = 0; tries < 40; tries++) {
    const i = W.free[rng.int(W.free.length)];
    if (W.dist[i] === INF) continue;
    fx = cellX(W, i); fz = cellZ(W, i);
    const d = Math.hypot(fx - px, fz - pz);
    if (d >= minD && d <= maxD) break;
  }
  out.x = fx; out.z = fz;
  return out;
}

/** Keep a point inside the arena (for flyers that ignore racks). */
export function clampInside(W, o, margin) {
  const lim = W.w * CELL / 2 - CELL - margin, limz = W.h * CELL / 2 - CELL - margin;
  o.x = o.x < -lim ? -lim : o.x > lim ? lim : o.x;
  o.z = o.z < -limz ? -limz : o.z > limz ? limz : o.z;
}
