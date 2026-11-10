// World geometry (floor tiles, racks, walls, ceiling) and the two instanced batches every dynamic
// thing is drawn with: boxes and glyphs.
import {
  BoxGeometry, BufferGeometry, BufferAttribute, InstancedBufferGeometry, InstancedBufferAttribute, Mesh, ShaderMaterial,
  CanvasTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, AdditiveBlending, DynamicDrawUsage, Scene, DoubleSide,
} from 'three';
import { CELL, RACK_H } from '../sim/config.js';
import { FLOOR, BLOCKS, BOXES, GLYPHS, SKY } from './shaders.js';
import { LOG_LINES } from './text.js';

const TILE = 1;
const FONT = '"JetBrains Mono", "Fira Code", "DejaVu Sans Mono", "Liberation Mono", Menlo, Consolas, monospace';
const world = (U) => ({
  uTime: U.uTime, uFog: U.uFog, uFogD: U.uFogD, uAccent: U.uAccent, uBass: U.uBass, uLightPos: U.uLightPos, uLightCol: U.uLightCol,
});

/** ASCII 32..127 in a 16x6 grid, cell aspect 0.6. */
function glyphAtlas() {
  const cw = 64, ch = 107, c = document.createElement('canvas');
  c.width = cw * 16; c.height = ch * 6;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#fff'; x.font = `bold 92px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i < 96; i++) x.fillText(String.fromCharCode(32 + i), (i % 16 + 0.5) * cw, ((i >> 4) + 0.52) * ch, cw - 2);
  const t = new CanvasTexture(c);
  t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  return t;
}

/** The wall of logs. */
function logTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, 1024, 1024);
  x.font = `bold 21px ${FONT}`; x.textBaseline = 'top';
  for (let i = 0; i < 34; i++) {
    const line = LOG_LINES[i % LOG_LINES.length];
    x.fillStyle = /ERROR|FATAL|panic|Killed/.test(line) ? '#fff' : /WARN/.test(line) ? '#bbb' : '#777';
    x.fillText(line, 6 + (i * 37) % 60, i * 30 + 5);
  }
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  return t;
}

/** Instanced copy of a base geometry. attrs: [name, Float32Array, itemSize]; dynamic: rewritten every frame. */
function instanced(base, attrs, count, dynamic = false) {
  const g = new InstancedBufferGeometry();
  g.index = base.index;
  for (const k of ['position', 'normal', 'uv']) g.setAttribute(k, base.attributes[k]);
  for (const [name, arr, size] of attrs) {
    const a = new InstancedBufferAttribute(arr, size);
    if (dynamic) a.setUsage(DynamicDrawUsage);
    g.setAttribute(name, a);
  }
  g.instanceCount = count;
  return g;
}

/** Set the instance count and upload only the instances written this frame: the arrays are sized for the worst case. */
function flush(geo, n, names) {
  geo.instanceCount = n;
  if (!n) return;
  for (const k of names) {
    const a = /** @type {import('three').BufferAttribute} */ (geo.attributes[k]);
    a.clearUpdateRanges();
    a.addUpdateRange(0, n * a.itemSize);
    a.needsUpdate = true;
  }
}

export class BoxBatch {
  constructor(max, U, additive) {
    this.max = max; this.n = 0;
    this.m = new Float32Array(max * 16); this.c = new Float32Array(max * 4); this.f = new Float32Array(max * 4);
    this.geo = instanced(new BoxGeometry(1, 1, 1), [['iM', this.m, 16], ['iCol', this.c, 4], ['iFx', this.f, 4]], 0, true);
    this.mesh = new Mesh(this.geo, new ShaderMaterial({
      ...BOXES, uniforms: world(U), defines: additive ? { ADD: 1 } : {},
      ...(additive ? { blending: AdditiveBlending, depthWrite: false, transparent: true } : {}),
    }));
    this.mesh.frustumCulled = false;
    this.x = this.y = this.z = 0; this.yaw = 0; this.cs = 1; this.sn = 0; this.s = 1; this.flash = 0; this.flicker = 0;
  }

  begin() { this.n = 0; }

  /** Transform for the boxes that follow: position, heading, uniform scale; flash and flicker apply to all of them. */
  base(x, y, z, yaw = 0, scale = 1, flash = 0, flicker = 0) {
    this.x = x; this.y = y; this.z = z; this.yaw = yaw; this.cs = Math.cos(yaw); this.sn = Math.sin(yaw); this.s = scale;
    this.flash = flash; this.flicker = flicker;
  }

  /** Box centred at local (lx, ly, lz) with size (sx, sy, sz); rx pitch, ry yaw, rz roll in the local frame. */
  box(lx, ly, lz, sx, sy, sz, r, g, b, glow = 0, rx = 0, ry = 0, rz = 0) {
    if (this.n >= this.max) return;
    const m = this.m, o = this.n * 16, q = this.n * 4, s = this.s, Y = this.yaw + ry;
    const cy = Math.cos(Y), sy_ = Math.sin(Y), cx = Math.cos(rx), sx_ = Math.sin(rx), cz = Math.cos(rz), sz_ = Math.sin(rz);
    sx *= s; sy *= s; sz *= s;
    m[o] = (cy * cz + sy_ * sx_ * sz_) * sx; m[o + 1] = cx * sz_ * sx; m[o + 2] = (-sy_ * cz + cy * sx_ * sz_) * sx; m[o + 3] = 0;
    m[o + 4] = (-cy * sz_ + sy_ * sx_ * cz) * sy; m[o + 5] = cx * cz * sy; m[o + 6] = (sy_ * sz_ + cy * sx_ * cz) * sy; m[o + 7] = 0;
    m[o + 8] = sy_ * cx * sz; m[o + 9] = -sx_ * sz; m[o + 10] = cy * cx * sz; m[o + 11] = 0;
    m[o + 12] = this.x + (lx * this.cs + lz * this.sn) * s; m[o + 13] = this.y + ly * s; m[o + 14] = this.z + (-lx * this.sn + lz * this.cs) * s;
    m[o + 15] = 1;
    this.c[q] = r; this.c[q + 1] = g; this.c[q + 2] = b; this.c[q + 3] = glow;
    this.f[q] = this.flash; this.f[q + 1] = 0; this.f[q + 2] = this.flicker; this.f[q + 3] = 0;
    this.n++;
  }

  /** Thin box from a to b in world space. */
  beam(ax, ay, az, bx, by, bz, w, r, g, b, glow = 1) {
    if (this.n >= this.max) return;
    let dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return;
    dx /= len; dy /= len; dz /= len;
    // X = up x dir, Y = dir x X; up switches to +x for near-vertical beams
    let xx, xy, xz;
    if (Math.abs(dy) > 0.99) { xx = 0; xy = dz; xz = -dy; } else { xx = dz; xy = 0; xz = -dx; }
    const xl = Math.hypot(xx, xy, xz);
    xx /= xl; xy /= xl; xz /= xl;
    const yx = dy * xz - dz * xy, yy = dz * xx - dx * xz, yz = dx * xy - dy * xx;
    const m = this.m, o = this.n * 16, q = this.n * 4;
    m[o] = xx * w; m[o + 1] = xy * w; m[o + 2] = xz * w; m[o + 3] = 0;
    m[o + 4] = yx * w; m[o + 5] = yy * w; m[o + 6] = yz * w; m[o + 7] = 0;
    m[o + 8] = dx * len; m[o + 9] = dy * len; m[o + 10] = dz * len; m[o + 11] = 0;
    m[o + 12] = (ax + bx) / 2; m[o + 13] = (ay + by) / 2; m[o + 14] = (az + bz) / 2; m[o + 15] = 1;
    this.c[q] = r; this.c[q + 1] = g; this.c[q + 2] = b; this.c[q + 3] = glow;
    this.f[q] = this.f[q + 1] = this.f[q + 2] = this.f[q + 3] = 0;
    this.n++;
  }

  end() { flush(this.geo, this.n, ['iM', 'iCol', 'iFx']); }
}

export class GlyphBatch {
  constructor(max, U, tex) {
    this.max = max; this.n = 0;
    this.p = new Float32Array(max * 4); this.c = new Float32Array(max * 4); this.g = new Float32Array(max * 2);
    const quad = new BufferGeometry();
    quad.setIndex([0, 1, 2, 2, 1, 3]);
    quad.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 0]), 3));
    quad.setAttribute('normal', new BufferAttribute(new Float32Array(12), 3));
    quad.setAttribute('uv', new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    this.geo = instanced(quad, [['iPos', this.p, 4], ['iCol', this.c, 4], ['iGlyph', this.g, 2]], 0, true);
    this.mesh = new Mesh(this.geo, new ShaderMaterial({
      ...GLYPHS, uniforms: { ...world(U), tGlyph: { value: tex } }, blending: AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  begin() { this.n = 0; }

  add(x, y, z, size, r, g, b, a, code, rot = 0) {
    if (this.n >= this.max || code <= 32) return;
    const q = this.n * 4, k = this.n * 2;
    this.p[q] = x; this.p[q + 1] = y; this.p[q + 2] = z; this.p[q + 3] = size;
    this.c[q] = r; this.c[q + 1] = g; this.c[q + 2] = b; this.c[q + 3] = a;
    this.g[k] = code - 32; this.g[k + 1] = rot;
    this.n++;
  }

  /** Billboarded text centred on (x, y, z); (rx, rz) is the camera's right vector on the ground plane. */
  text(str, x, y, z, size, r, g, b, a, rx, rz) {
    const step = size * 0.6, x0 = -(str.length - 1) / 2 * step;
    for (let i = 0; i < str.length; i++) {
      const o = x0 + i * step;
      this.add(x + rx * o, y, z + rz * o, size, r, g, b, a, str.charCodeAt(i));
    }
  }

  end() { flush(this.geo, this.n, ['iPos', 'iCol', 'iGlyph']); }
}

export function makeWorldView(gfx) {
  const U = gfx.U, scene = new Scene(), tex = { glyph: glyphAtlas(), logs: logTexture() };
  const v = {
    scene, boxes: new BoxBatch(900, U, false), glow: new BoxBatch(400, U, true), glyphs: new GlyphBatch(2600, U, tex.glyph),
    floor: null, blocks: null,

    /** Rebuild the static geometry for a sim world. */
    setWorld(W) {
      for (const m of [v.floor, v.blocks]) if (m) { scene.remove(m); m.geometry.dispose(); }
      const tiles = [], blocks = [], sizes = [], kinds = [], n = CELL / TILE;
      let seed = W.map * 7919 + 17;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (let i = 0; i < W.w * W.h; i++) {
        const cx = W.ox + (i % W.w) * CELL, cz = W.oz + ((i / W.w) | 0) * CELL, k = W.kind[i];
        if (k === 0) {
          for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) tiles.push(cx + (a + 0.5) * TILE, cz + (b + 0.5) * TILE, rnd());
        } else {
          const h = k === 1 ? RACK_H : 16, s = k === 1 ? CELL * 0.955 : CELL;
          blocks.push(cx + CELL / 2, h / 2, cz + CELL / 2); sizes.push(s, h, s); kinds.push(k - 1, k === 1 ? rnd() : 0);
        }
      }
      const tile = new BoxGeometry(1, 1, 1);
      tile.translate(0, -0.5, 0);
      v.floor = new Mesh(instanced(tile, [['iTile', new Float32Array(tiles), 3]], tiles.length / 3),
        new ShaderMaterial({ ...FLOOR, uniforms: { ...world(U), uRip: U.uRip, uTile: { value: TILE } } }));
      v.blocks = new Mesh(instanced(new BoxGeometry(1, 1, 1), [['iPos', new Float32Array(blocks), 3],
        ['iSize', new Float32Array(sizes), 3], ['iKind', new Float32Array(kinds), 2]], kinds.length / 2),
      new ShaderMaterial({ ...BLOCKS, uniforms: { ...world(U), tLogs: { value: tex.logs }, uAlarm: U.uAlarm } }));
      for (const m of [v.floor, v.blocks]) { m.frustumCulled = false; scene.add(m); }
    },
  };
  const sky = new BufferGeometry();
  sky.setIndex([0, 2, 1, 2, 3, 1]);
  sky.setAttribute('position', new BufferAttribute(new Float32Array([-140, 15, -140, 140, 15, -140, -140, 15, 140, 140, 15, 140]), 3));
  const skyMesh = new Mesh(sky, new ShaderMaterial({ ...SKY, uniforms: world(U), side: DoubleSide }));
  skyMesh.frustumCulled = false;
  scene.add(skyMesh, v.boxes.mesh, v.glow.mesh, v.glyphs.mesh);
  return v;
}
