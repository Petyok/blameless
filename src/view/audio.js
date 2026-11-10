// Sound: every effect is synthesized into a buffer at start-up; music streams from assets/music,
// the announcer from assets/voice. Missing assets are skipped: the game runs silent rather than not at all.
import { VOICE } from './text.js';

const TAU = Math.PI * 2;

/** Sound recipes: [seconds, (t, d) => sample]. d: duration. State lives in closures made per render. */
export function recipes() {
  const noise = () => Math.random() * 2 - 1;
  const lp = (k) => { let y = 0; return (x) => (y += (x - y) * k); };
  const sq = (ph) => (Math.sin(ph) > 0 ? 1 : -1);
  const saw = (ph) => 2 * (ph / TAU - Math.floor(ph / TAU + 0.5));
  const env = (t, a, dec) => Math.min(1, t / a) * Math.exp(-t * dec);
  /** Phase of a tone gliding from f0 to f1 with rate k. */
  const glide = (t, f0, f1, k) => TAU * (f1 * t + (f0 - f1) * (1 - Math.exp(-k * t)) / k);
  const mk = (fn) => fn();
  return {
    term: [0.14, mk(() => { const f = lp(0.5); return (t) => Math.sin(glide(t, 1100, 150, 45)) * env(t, 0.001, 30) * 0.8 + f(noise()) * env(t, 0.001, 70) * 0.7; })],
    kill: [0.5, mk(() => { const f = lp(0.25), f2 = lp(0.04); return (t) => Math.tanh((f(noise()) * env(t, 0.001, 9) * 1.6 + Math.sin(glide(t, 130, 38, 14)) * env(t, 0.002, 7) * 1.2 + f2(noise()) * env(t, 0.01, 5)) * 1.8) * 0.9; })],
    grep: [0.55, mk(() => { const f = lp(0.3); return (t) => (Math.sin(glide(t, 3200, 160, 9) + 2.5 * Math.sin(glide(t, 1300, 90, 7))) * env(t, 0.002, 6) + f(noise()) * env(t, 0.001, 25) * 0.6) * 0.7; })],
    rm: [0.45, mk(() => { const f = lp(0.12); return (t) => f(noise()) * Math.sin(Math.min(1, t / 0.4) * Math.PI) * 1.4 + Math.sin(glide(t, 160, 50, 10)) * env(t, 0.002, 12) * 0.9; })],
    boom: [1.1, mk(() => { let y = 0; return (t) => { y += (noise() - y) * Math.max(0.012, 0.5 * Math.exp(-t * 5)); return Math.tanh((y * env(t, 0.002, 3.2) * 3.2 + Math.sin(glide(t, 95, 28, 6)) * env(t, 0.004, 4.5) * 1.3) * 1.5) * 0.95; }; })],
    hit: [0.04, (t) => Math.sin(TAU * 1750 * t) * env(t, 0.001, 90) * 0.5],
    confirm: [0.12, (t) => sq(TAU * (t < 0.045 ? 880 : 1320) * t) * env(t, 0.002, 22) * 0.3],
    dry: [0.05, (t) => Math.sin(TAU * 180 * t) * env(t, 0.001, 80) * 0.6 + noise() * env(t, 0.001, 200) * 0.2],
    overheat: [0.34, (t) => (t % 0.17 < 0.11 ? sq(TAU * 196 * t) + sq(TAU * 247 * t) : 0) * 0.2],
    cool: [0.16, (t) => Math.sin(glide(t, 500, 1300, 14)) * env(t, 0.005, 16) * 0.3],
    dash: [0.26, mk(() => { const f = lp(0.2); return (t) => f(noise()) * Math.sin(Math.min(1, t / 0.26) * Math.PI) ** 2 * 0.9; })],
    jump: [0.09, (t) => Math.sin(glide(t, 170, 300, 20)) * env(t, 0.004, 30) * 0.35],
    land: [0.14, mk(() => { const f = lp(0.08); return (t) => Math.sin(glide(t, 110, 45, 25)) * env(t, 0.002, 22) * 0.8 + f(noise()) * env(t, 0.001, 40) * 0.8; })],
    hurt: [0.3, mk(() => { const f = lp(0.15); return (t) => Math.tanh((saw(glide(t, 150, 55, 12)) * env(t, 0.002, 11) + f(noise()) * env(t, 0.001, 20)) * 2.5) * 0.7; })],
    coffee: [0.32, (t) => Math.sin(glide(t, 320, 1050, 7) + Math.sin(TAU * 31 * t) * 1.5) * env(t, 0.02, 7) * 0.35],
    rollback: [0.5, mk(() => { const f = lp(0.3); return (t, d) => (saw(TAU * (140 + 1900 * (t / d) ** 2) * t) * 0.35 + f(noise()) * 0.5) * (t / d) ** 1.5 * (t > d - 0.02 ? (d - t) / 0.02 : 1); })],
    sudo: [0.7, (t) => { const n = [262, 330, 392, 523, 659][Math.min(4, Math.floor(t / 0.09))]; return (sq(TAU * n * t) * 0.5 + sq(TAU * n * 2.005 * t) * 0.25) * env(t, 0.002, 2.6) * 0.35; }],
    perk: [0.6, (t) => (Math.sin(TAU * 784 * t) + Math.sin(TAU * 1175 * t) * (t > 0.08 ? 1 : 0)) * env(t, 0.003, 6) * 0.25],
    ui: [0.012, (t) => Math.sin(TAU * 3200 * t) * env(t, 0.0005, 400) * 0.25 + noise() * env(t, 0.0005, 700) * 0.2],
    enter: [0.06, (t) => Math.sin(TAU * 700 * t) * env(t, 0.001, 70) * 0.4 + noise() * env(t, 0.0005, 400) * 0.3],
    spawn: [0.2, (t) => Math.sin(glide(t, 200, 900, 12) + Math.sin(TAU * 60 * t) * 2) * env(t, 0.01, 14) * 0.25],
    ding: [0.5, (t) => (Math.sin(TAU * 1568 * t) + 0.5 * Math.sin(TAU * 3136 * t) + 0.3 * Math.sin(TAU * 4310 * t)) * env(t, 0.001, 9) * 0.3],
    eshot: [0.16, (t) => (Math.sin(glide(t, 900, 240, 18)) + 0.4 * sq(glide(t, 450, 120, 18))) * env(t, 0.002, 20) * 0.4],
    blink: [0.12, (t) => sq(TAU * (300 + 2400 * (((Math.floor(t * 110) * 7919) % 13) / 13)) * t) * env(t, 0.001, 14) * 0.25],
    roar: [0.75, (t, d) => Math.tanh(saw(TAU * (52 + 60 * (t / d) ** 2) * t) * (1 + 0.6 * Math.sin(TAU * 27 * t)) * 2) * Math.sin(Math.PI * Math.min(1, t / d)) * 0.6],
    crash: [0.7, mk(() => { const f = lp(0.35); return (t) => ((Math.sin(TAU * 311 * t) + Math.sin(TAU * 517 * t) + Math.sin(TAU * 839 * t) + Math.sin(TAU * 1193 * t)) * 0.2 * env(t, 0.001, 7) + f(noise()) * env(t, 0.001, 14)) * 0.9; })],
    fuse: [1.3, (t, d) => { const r = 6 + 22 * (t / d) ** 2, ph = (t * r) % 1; return ph < 0.4 ? Math.sin(TAU * (880 + 500 * t / d) * t) * 0.3 : 0; }],
    split: [0.2, (t) => (Math.sin(glide(t, 260, 90, 30)) * env(t, 0.001, 35) + sq(TAU * (t < 0.09 ? 0 : t < 0.14 ? 990 : 1320) * t) * 0.3 * env(Math.max(0, t - 0.09), 0.001, 25)) * 0.6],
    ring: [0.7, (t) => Math.tanh(Math.sin(glide(t, 120, 41, 5)) * env(t, 0.004, 4) * 2.2) * 0.8 + Math.sin(TAU * 2637 * t) * env(t, 0.001, 12) * 0.08],
    shield: [0.2, (t) => (Math.sin(TAU * 2093 * t) + 0.6 * Math.sin(TAU * 3349 * t)) * env(t, 0.0005, 22) * 0.25],
    alarm: [0.9, (t) => sq(TAU * (t % 0.3 < 0.15 ? 622 : 466) * t) * 0.16 * Math.min(1, (0.9 - t) * 12) * Math.min(1, t * 80)],
    clear: [0.8, (t) => { const n = [523, 659, 784, 1047][Math.min(3, Math.floor(t / 0.11))]; return (Math.sin(TAU * n * t) + 0.3 * Math.sin(TAU * n * 2 * t)) * env(t, 0.003, 3.4) * 0.28; }],
    phone: [1.6, (t) => { const on = (t % 0.8) < 0.42; return on ? Math.tanh(sq(TAU * 155 * t) * (0.6 + 0.4 * Math.sin(TAU * 23 * t)) * 1.5) * 0.3 * Math.min(1, ((t % 0.8)) * 60) : 0; }],
    dead: [1.5, mk(() => { const f = lp(0.06); return (t, d) => (saw(TAU * 220 * Math.exp(-t * 2.2) * t) * 0.5 + f(noise()) * 1.2) * Math.exp(-t * 1.8) * Math.min(1, (d - t) * 20); })],
    tick: [0.03, (t) => Math.sin(TAU * 2400 * t) * env(t, 0.0005, 160) * 0.35],
  };
}

/** Render one recipe to samples; loud ones are scaled down so nothing clips (peak at most 0.9). */
export function renderSound([dur, fn], sampleRate) {
  const n = Math.floor(dur * sampleRate), d = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) { d[i] = fn(i / sampleRate, dur); peak = Math.max(peak, Math.abs(d[i])); }
  if (peak > 0.9) for (let i = 0; i < n; i++) d[i] *= 0.9 / peak;
  return d;
}

// minimum seconds between two plays of the same sound
const GAP = { hit: 0.035, confirm: 0.05, eshot: 0.05, spawn: 0.08, boom: 0.06, split: 0.06, shield: 0.08, blink: 0.05, tick: 0.05 };

export function makeAudio(settings) {
  const a = {
    ctx: null, ready: false, bass: 0, level: 0, onSay: null, volume: settings,
    buffers: {}, voices: {}, last: {}, lx: 0, lz: 0, lyaw: 0, music: null, musicName: '', sayQ: [], saying: 0, sayCd: {},

    /** Must be called from a user gesture. A machine without working audio gets a silent game, not a stuck one. */
    init(base = 'assets/') {
      if (a.ctx) { a.ctx.resume().catch(() => {}); return; }
      try {
        const ctx = a.ctx = new AudioContext({ latencyHint: 'interactive' });
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
        a.master = ctx.createGain(); a.sfx = ctx.createGain(); a.mus = ctx.createGain(); a.vox = ctx.createGain();
        a.analyser = ctx.createAnalyser(); a.analyser.fftSize = 512; a.analyser.smoothingTimeConstant = 0.5;
        a.spectrum = new Uint8Array(a.analyser.frequencyBinCount);
        // the analyser sits before the music gain, so the floor pulses at any volume
        a.sfx.connect(comp); a.vox.connect(comp); a.analyser.connect(a.mus); a.mus.connect(comp);
        comp.connect(a.master); a.master.connect(ctx.destination);
        a.applyVolume();
        for (const [name, [dur, fn]] of Object.entries(recipes())) {
          const d = renderSound([dur, fn], ctx.sampleRate), b = ctx.createBuffer(1, d.length, ctx.sampleRate);
          b.copyToChannel(d, 0);
          a.buffers[name] = b;
        }
        a.base = base;
        for (const id of Object.keys(VOICE)) {
          fetch(`${base}voice/${id}.ogg`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(r.status)))
            .then((buf) => ctx.decodeAudioData(buf)).then((b) => { a.voices[id] = b; }).catch(() => {});
        }
        a.ready = true;
      } catch (e) {
        console.warn('audio unavailable, running silent:', e);
        a.ctx = null; a.ready = false;
      }
    },
    applyVolume() {
      if (!a.ctx) return;
      const v = a.volume;
      a.master.gain.value = v.master; a.sfx.gain.value = v.sfx; a.mus.gain.value = v.music * 0.5; a.vox.gain.value = v.voice * 1.15;
    },
    listener(x, z, yaw) { a.lx = x; a.lz = z; a.lyaw = yaw; },

    /** o: {vol, rate, x, z} — with x,z the sound is placed in the world. */
    play(name, o = {}) {
      if (!a.ready || a.ctx.state !== 'running') return;
      const now = a.ctx.currentTime, b = a.buffers[name];
      if (!b || now - (a.last[name] || -1) < (GAP[name] || 0)) return;
      a.last[name] = now;
      let vol = o.vol ?? 1, pan = 0;
      if (o.x !== undefined) {
        const dx = o.x - a.lx, dz = o.z - a.lz, d = Math.hypot(dx, dz);
        vol *= 1 / (1 + (d / 9) ** 2);
        if (vol < 0.012) return;
        pan = d > 0.5 ? (dx * Math.cos(a.lyaw) - dz * Math.sin(a.lyaw)) / d * 0.8 : 0;
      }
      const src = a.ctx.createBufferSource(), g = a.ctx.createGain();
      src.buffer = b; src.playbackRate.value = (o.rate || 1) * (0.96 + Math.random() * 0.08);
      g.gain.value = vol;
      if (pan) { const p = a.ctx.createStereoPanner(); p.pan.value = pan; src.connect(g).connect(p).connect(a.sfx); } else src.connect(g).connect(a.sfx);
      src.start();
      return src;
    },
    /** A looping sound; returns a stop function. */
    loop(name, vol = 1) {
      if (!a.ready) return () => {};
      const src = a.ctx.createBufferSource(), g = a.ctx.createGain();
      src.buffer = a.buffers[name]; src.loop = true; g.gain.value = vol;
      src.connect(g).connect(a.sfx); src.start();
      return () => { try { src.stop(); } catch { /* already stopped */ } };
    },

    /** Crossfade to a music track (assets/music/<name>.ogg); '' fades to silence. */
    setMusic(name, fade = 1.4) {
      if (!a.ready || name === a.musicName) return;
      a.musicName = name;
      const t = a.ctx.currentTime, old = a.music;
      if (old) {
        old.gain.gain.cancelScheduledValues(t); old.gain.gain.setValueAtTime(old.gain.gain.value, t); old.gain.gain.linearRampToValueAtTime(0, t + fade);
        setTimeout(() => { old.el.pause(); old.el.src = ''; old.node.disconnect(); }, fade * 1000 + 100);
      }
      a.music = null;
      if (!name) return;
      const el = new Audio(`${a.base}music/${name}.ogg`);
      el.loop = true; el.preload = 'auto';
      const node = a.ctx.createMediaElementSource(el), gain = a.ctx.createGain();
      gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(1, t + fade);
      node.connect(gain).connect(a.analyser);
      el.play().catch(() => {});
      a.music = { el, node, gain };
    },
    pauseMusic(paused) { if (a.music) { if (paused) a.music.el.pause(); else a.music.el.play().catch(() => {}); } },

    /**
     * Queue an announcer line. cooldown: seconds before the same id may play again; urgent: jump the queue.
     * Runs on the wall clock, so subtitles still appear when the machine has no working audio.
     */
    say(id, cooldown = 0, urgent = false) {
      const now = performance.now() / 1000;
      if (now < (a.sayCd[id] || 0) || a.sayQ.includes(id)) return;
      a.sayCd[id] = now + cooldown;
      if (urgent) a.sayQ.unshift(id); else if (a.sayQ.length < 3) a.sayQ.push(id);
    },
    hush() { a.sayQ.length = 0; if (a.voiceSrc) { try { a.voiceSrc.stop(); } catch { /* done */ } } a.saying = 0; },

    /** Per frame: announcer queue, music ducking, bass level for the floor. */
    update(dt) {
      const now = performance.now() / 1000;
      if (a.sayQ.length && now >= a.saying) {
        const id = a.sayQ.shift(), b = a.voices[id], dur = b ? b.duration : 1.2 + VOICE[id].length * 0.045;
        if (b && a.ready && a.ctx.state === 'running') {
          const src = a.voiceSrc = a.ctx.createBufferSource();
          src.buffer = b; src.connect(a.vox); src.start();
        }
        a.saying = now + dur + 0.25;
        if (a.onSay) a.onSay(id, dur);
      }
      if (!a.ready) return;
      const duck = now < a.saying ? 0.45 : 1, v = a.volume.music * 0.5 * duck;
      a.mus.gain.value += (v - a.mus.gain.value) * Math.min(1, dt * 6);
      a.analyser.getByteFrequencyData(a.spectrum);
      // bass: 0..1 pulse on kicks. The low bins sit high all the time in loud music, so it is the energy above
      // the slow average that counts, with a fast attack and a short tail.
      const raw = (a.spectrum[1] + a.spectrum[2] + a.spectrum[3]) / 765;
      a.level += (raw - a.level) * Math.min(1, dt * (a.level ? 1.2 : 1e9));
      const kick = Math.min(1, Math.max(0, raw - a.level) * 12);
      a.bass += (kick - a.bass) * Math.min(1, dt * (kick > a.bass ? 45 : 11));
    },
  };
  return a;
}
