// ─────────────────────────────────────────────────────────────
//  KOVELI Awards – lucky draw machine (air-mix ping-pong balls)
//  Shared by index.html (staff) and admin.html.
//
//  How it works
//  • Air blows up from the bottom of the bowl and keeps every ball flying around.
//  • At 0 the cap opens; the FIRST ball that flies into the door goes out.
//  • The physics is deterministic: the admin picks a random seed, runs the
//    simulation once to see which ball reaches the door first (that's the winner),
//    and every phone replays exactly the same simulation from the same seed.
//    (Only + − × ÷ and √ are used, which give identical results in every browser.)
//
//  Timeline (ms)
//     0 – 900    air ramps up
//  6000 – 9000   3 · 2 · 1 countdown
//  9000 – 9150   cap opens (air keeps blowing)
//  C             first ball reaches the door (C ≥ 9150, usually within a second)
//  C → C+500     ball shoots up the neck
//  C+500 → C+900 cap closes
//  C+700 → C+1500 air slows down, the other balls drop
//  C+2000        name revealed
// ─────────────────────────────────────────────────────────────

export const STEP = 1000 / 60;          // physics step (ms)
export const MAX_BALLS = 40;
export const DRAW_MS = 12000;           // typical length of one draw
const T = { accel: 900, countdown: 6000, open: 9000, opened: 9150, giveUp: 13500 };
const OUT_MS = 500, CLOSE_MS = 900, CALM_START = 700, CALM_END = 1500, REVEAL_AFTER = 2000;

const COLORS = ["#ffcc33", "#ff5c8a", "#7aa7ff", "#3ddc97", "#ff9f43", "#c38bff", "#4dd9e8", "#f4f4fb"];
const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

const escHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBack = (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const prog = (e, a, b) => clamp01((e - a) / (b - a));

// Cryptographically fair random index.
export function fairIndex(n) {
  const a = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do { crypto.getRandomValues(a); } while (a[0] >= limit);
  return a[0] % n;
}
export function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

// Small deterministic random generator (same numbers in every browser).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ═════════════════════ physics (unit bowl: centre 0,0 · radius 1 · y points down) ═════════════════════
export function ballRadius(n) {
  return Math.max(0.055, Math.min(0.12, 0.62 / Math.sqrt(Math.max(n, 1) * 1.35)));
}

const G = 0.0025;      // gravity per step
// Air comes in bursts: a ball in the lower part of the bowl is randomly launched upward.
export const PHYS = { FUNNEL: 0.12, KICK_P: 0.2, KICK_Y: 0.2, KICK_MIN: 0.045, KICK_RANGE: 0.065, DAMP: 0.995, VMAX: 0.13, FRESH: 40, DOOR_W: 1.3 };

class Sim {
  constructor(n, rand, positions) {
    this.rand = rand;
    this.r = ballRadius(n);
    this.t = 0;
    this.balls = [];
    const lim = 1 - this.r - 0.02;
    for (let i = 0; i < n; i++) {
      let x, y;
      if (positions && positions[i]) { x = positions[i].x; y = positions[i].y; }
      else {
        do { x = this.rand() * 2 - 1; y = this.rand() * 1.7 - 0.75; } while (x * x + y * y > lim * lim);
      }
      // rot/w = how the ball is turned / spinning (only for looks)
      this.balls.push({ x, y, vx: 0, vy: 0, out: false, rot: i * 1.7, w: 0, low: 0 });
    }
  }

  step(air) {
    const { r, rand } = this;
    const live = this.balls;
    for (let i = 0; i < live.length; i++) {
      const b = live[i];
      if (b.out) continue;
      if (air > 0) {
        if (b.y > PHYS.KICK_Y && rand() < PHYS.KICK_P * air) {      // air burst from the bottom
          const boost = air > 1 ? air : 1;
          b.vy = -(PHYS.KICK_MIN + rand() * PHYS.KICK_RANGE) * boost * (air < 1 ? 0.5 + 0.5 * air : 1);
          b.vx += (rand() - 0.5) * 0.06;
          b.w += (rand() - 0.5) * 0.5;                               // the burst sets it spinning
          if (air > 1) b.vx -= b.x * PHYS.FUNNEL;                    // when the cap is open, air aims at the door
        }
        b.vx += (rand() - 0.5) * 0.004 * air;                       // turbulence
        b.vy += (rand() - 0.5) * 0.003 * air;
      }
      b.vy += G;
      b.vx *= PHYS.DAMP; b.vy *= PHYS.DAMP;
      const sp2 = b.vx * b.vx + b.vy * b.vy;
      const vm = PHYS.VMAX;
      if (sp2 > vm * vm) { const k = vm / Math.sqrt(sp2); b.vx *= k; b.vy *= k; }
      b.x += b.vx; b.y += b.vy;
      b.rot += b.w; b.w *= 0.985;
      if (b.y > 0.1) b.low = this.t;                                 // last time it was in the lower half
      // bowl wall
      const lim = 1 - r - 0.015;
      const d2 = b.x * b.x + b.y * b.y;
      if (d2 > lim * lim) {
        const d = Math.sqrt(d2), nx = b.x / d, ny = b.y / d;
        b.x = nx * lim; b.y = ny * lim;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) {
          b.vx -= 1.7 * vn * nx; b.vy -= 1.7 * vn * ny;
          b.w += ((b.vx * -ny + b.vy * nx) / r) * 0.25;              // rolling along the glass spins it
        }
      }
    }
    // ball–ball collisions
    const min = 2 * r;
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      if (a.out) continue;
      for (let j = i + 1; j < live.length; j++) {
        const c = live[j];
        if (c.out) continue;
        const dx = c.x - a.x, dy = c.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = (min - d) / 2;
          a.x -= nx * ov; a.y -= ny * ov; c.x += nx * ov; c.y += ny * ov;
          const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (rel < 0) {
            const imp = -rel * 0.92;
            a.vx -= imp * nx; a.vy -= imp * ny; c.vx += imp * nx; c.vy += imp * ny;
            const tang = ((c.vx - a.vx) * -ny + (c.vy - a.vy) * nx) / r;  // glancing hits spin both balls
            a.w -= tang * 0.15; c.w -= tang * 0.15;
          }
        }
      }
    }
    this.t++;
  }

  inDoor(b) {
    const r = this.r;
    return b.x < r * PHYS.DOOR_W && b.x > -r * PHYS.DOOR_W && b.y < -1 + r + 0.06;
  }
  // Index of a ball that has just flown up into the open door, or -1.
  // Only a ball that came up from the lower half within the last ~0.75 s counts,
  // so balls hanging around the top have no advantage.
  ballEnteringDoor() {
    let best = -1, bestY = Infinity;
    for (let i = 0; i < this.balls.length; i++) {
      const b = this.balls[i];
      if (b.out) continue;
      const inside = this.inDoor(b);
      if (inside && !b.wasIn && this.t - b.low <= PHYS.FRESH && b.y < bestY) { best = i; bestY = b.y; }
      b.wasIn = inside;
    }
    return best;
  }
  nearestToDoor() {
    let best = 0, bd = Infinity;
    this.balls.forEach((b, i) => {
      const d = b.x * b.x + (b.y + 1) * (b.y + 1);
      if (!b.out && d < bd) { bd = d; best = i; }
    });
    return best;
  }
}

// Air strength at a given step (catchStep unknown → keep blowing).
function airAt(step, catchStep) {
  const ms = step * STEP;
  if (ms < T.accel) return ms / T.accel;
  if (catchStep == null || step <= catchStep) return ms < T.open - 400 ? 1 : 1.3;
  const after = (step - catchStep) * STEP;
  if (after < CALM_START) return 1;
  if (after < CALM_END) return 1 - (after - CALM_START) / (CALM_END - CALM_START);
  return 0;
}

// Admin: run the draw once to find out which ball reaches the door first.
export function planDraw(pool, seed) {
  const sim = new Sim(pool.length, mulberry32(seed));
  const openedStep = Math.ceil(T.opened / STEP);
  const giveUp = Math.ceil(T.giveUp / STEP);
  for (;;) {
    sim.step(airAt(sim.t, null));
    if (sim.t >= openedStep - 1) {
      let i = sim.ballEnteringDoor();
      if (sim.t < openedStep) continue;   // just records who is already there
      if (i < 0 && sim.t >= giveUp) i = sim.nearestToDoor();
      if (i >= 0) return { winner: pool[i], winnerIndex: i, catchStep: sim.t };
    }
  }
}

// Pick up to MAX_BALLS names in a fair random order (admin).
export function drawPool(names) {
  const a = [...names];
  for (let i = a.length - 1; i > 0; i--) { const j = fairIndex(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, MAX_BALLS);
}

export const revealTime = (spin) => (spin && spin.catchStep != null ? spin.catchStep * STEP + REVEAL_AFTER : DRAW_MS);

// ═════════════════════ drawing ═════════════════════
export class DrawMachine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.names = [];
    this.sim = new Sim(0, Math.random);
    this.mode = "idle";      // idle | spin | reveal
    this.spin = null;
    this.revealName = null;
    this.onReveal = null;
    this.lid = 0;
    this._resize = this.resize.bind(this);
    window.addEventListener("resize", this._resize);
    this.resize();
    this._loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this._loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this._resize);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth || 320;
    const h = Math.min(Math.round(w * 1.08), 640);
    this.canvas.style.height = h + "px";
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.R = Math.min(w * 0.45, h * 0.41);
    this.cx = w / 2;
    this.cy = h * 0.53;
  }

  get ballR() { return this.sim.r * this.R; }
  px(b) { return { x: this.cx + b.x * this.R, y: this.cy + b.y * this.R }; }

  geom() {
    const { cx, cy, R } = this;
    const br = Math.max(this.ballR, 8);
    this.doorHalf = br * 1.35;
    this.doorAng = Math.asin(Math.min(0.9, this.doorHalf / R));
    this.neckBottom = cy - R * Math.cos(this.doorAng);
    this.neckTop = this.neckBottom - br * 1.7;
    this.exitY = this.neckTop - br - 6;
  }

  // Resting balls (not drawing). Keeps the positions of names that are still there.
  setPool(names) {
    const list = names.slice(0, MAX_BALLS);
    const same = list.length === this.names.length && list.every((n, i) => n === this.names[i]);
    if (same && this.mode !== "spin") return;
    const old = new Map(this.names.map((n, i) => [n, this.sim.balls[i]]));
    const pos = list.map((n) => { const b = old.get(n); return b && !b.out ? { x: b.x, y: b.y } : null; });
    this.names = list;
    this.sim = new Sim(list.length, Math.random, pos);
    this.mode = this.mode === "spin" ? "idle" : this.mode;
  }

  // Start (or join) a draw. offsetMs = how far into it we already are.
  startSpin(spin, offsetMs = 0) {
    const pool = spin.pool || [];
    if (spin.seed == null || spin.catchStep == null) return this.showWinner(spin.winner, pool);
    const reveal = revealTime(spin);
    if (offsetMs >= reveal) return this.showWinner(spin.winner, pool);
    // remember where the resting balls were, to glide them into the starting positions
    const prev = new Map(this.names.map((n, i) => [n, this.sim.balls[i]]));
    this.names = [...pool];
    this.sim = new Sim(pool.length, mulberry32(spin.seed));
    this.from = this.names.map((n) => { const b = prev.get(n); return b ? { x: b.x, y: b.y } : null; });
    this.mode = "spin";
    this.revealName = null;
    this.lid = 0;
    const wi = pool.indexOf(spin.winner);
    this.spin = {
      winner: spin.winner, wi: wi < 0 ? 0 : wi, catchStep: spin.catchStep,
      catchMs: spin.catchStep * STEP, reveal, start: performance.now() - offsetMs,
      revealed: false, caught: false,
    };
  }

  showWinner(name, pool) {
    const rest = (pool && pool.length ? pool : this.names).filter((n) => n !== name);
    this.mode = "reveal";
    this.spin = null;
    this.setPool(rest);
    this.revealName = name;
    this.revealColor = COLORS[Math.max(0, (pool || this.names).indexOf(name)) % COLORS.length];
    this.lid = 0;
    this.revealAt = performance.now();
  }

  idle() {
    this.mode = "idle";
    this.spin = null;
    this.revealName = null;
    this.lid = 0;
  }

  loop(now) {
    this.raf = requestAnimationFrame(this._loop);
    const { ctx } = this;
    this.geom();

    let e = 0, count = 0, countFrac = 0, air = 0;
    const sp = this.mode === "spin" ? this.spin : null;

    if (sp) {
      e = now - sp.start;
      // advance the shared simulation to the current time (fixed steps → same on every phone)
      const target = Math.floor(e / STEP);
      while (this.sim.t < target) {
        if (this.sim.t === sp.catchStep && !sp.caught) {
          const b = this.sim.balls[sp.wi];
          sp.caught = true;
          sp.hx = b.x; sp.hy = b.y;
          b.out = true;
        }
        this.sim.step(airAt(this.sim.t, sp.catchStep));
      }
      if (this.sim.t > sp.catchStep && !sp.caught) {
        const b = this.sim.balls[sp.wi];
        sp.caught = true; sp.hx = b.x; sp.hy = b.y; b.out = true;
      }
      air = airAt(this.sim.t, sp.catchStep);

      if (e >= T.countdown && e < T.open) {
        const s = (e - T.countdown) / 1000;
        count = 3 - Math.floor(s);
        countFrac = s - Math.floor(s);
      }
      const C = sp.catchMs;
      this.lid = e < T.open ? 0 : e < T.opened ? easeOutBack(prog(e, T.open, T.opened))
        : e < C + OUT_MS ? 1 : 1 - easeInOut(prog(e, C + OUT_MS, C + CLOSE_MS));

      if (e >= sp.reveal && !sp.revealed) {
        sp.revealed = true;
        const name = sp.winner, pool = [...this.names];
        // keep the other balls where they are
        this.mode = "reveal";
        this.spin = null;
        this.revealName = name;
        this.revealColor = COLORS[sp.wi % COLORS.length];
        this.revealAt = now;
        const keep = this.sim.balls.map((b) => ({ x: b.x, y: b.y }));
        const rest = pool.filter((n, i) => i !== sp.wi);
        this.names = rest;
        this.sim = new Sim(rest.length, Math.random, keep.filter((_, i) => i !== sp.wi));
        if (this.onReveal) this.onReveal(name);
      }
    } else {
      this.sim.step(0); // resting balls settle under gravity
    }

    // ───────── draw ─────────
    const { w, h, cx, cy, R } = this;
    ctx.clearRect(0, 0, w, h);
    this.drawStand();

    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    g.addColorStop(0, "rgba(255,255,255,0.16)");
    g.addColorStop(1, "rgba(122,167,255,0.06)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // air jets from the bottom
    if (air > 0) this.drawAir(now, Math.min(1, air));

    // balls inside (glide from resting spots during the first 0.5 s of a draw)
    const blend = sp ? easeInOut(prog(e, 0, 500)) : 1;
    const br = this.ballR;
    this.sim.balls.forEach((b, i) => {
      if (b.out) return;
      let { x, y } = this.px(b);
      const f = sp && this.from && this.from[i];
      if (f && blend < 1) {
        const p0 = this.px(f);
        x = p0.x + (x - p0.x) * blend; y = p0.y + (y - p0.y) * blend;
      }
      this.drawBall(x, y, br, COLORS[i % COLORS.length], this.names[i], b.rot, false);
    });

    // winner shooting up the neck
    let flying = null;
    if (sp && sp.caught) {
      const C = sp.catchMs;
      const color = COLORS[sp.wi % COLORS.length];
      if (e < C + OUT_MS) {
        const t = 1 - Math.pow(1 - prog(e, C, C + OUT_MS), 2);
        const s = this.px({ x: sp.hx, y: sp.hy });
        this.drawBall(s.x + (cx - s.x) * Math.min(1, t * 2.5), s.y + (this.exitY - s.y) * t, br, color, sp.winner, 0, false);
      } else {
        flying = { t: prog(e, C + OUT_MS, sp.reveal), color, name: sp.winner };
      }
    }

    this.drawRimAndCap();

    if (flying) {
      const t = easeInOut(flying.t);
      ctx.fillStyle = `rgba(15,16,32,${0.55 * t})`;
      ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, Math.PI * 2); ctx.fill();
      const x = cx + Math.sin(t * Math.PI) * R * 0.75;
      const y = this.exitY + (cy - this.exitY) * t - Math.sin(t * Math.PI) * R * 0.15;
      const r = br + (R * 0.66 - br) * t;
      this.drawBall(x, y, r, flying.color, flying.name, 0, r > br * 2.2);
    }

    if (count > 0) this.drawCount(count, countFrac);

    if (this.mode === "reveal" && this.revealName) {
      const pulse = 1 + Math.sin((now - (this.revealAt || now)) / 260) * 0.025;
      ctx.fillStyle = "rgba(15,16,32,0.55)";
      ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.shadowColor = "rgba(255,204,51,0.85)";
      ctx.shadowBlur = 40;
      this.drawBall(cx, cy, R * 0.66 * pulse, this.revealColor || "#ffcc33", this.revealName, 0, true);
      ctx.restore();
    }
  }

  drawAir(now, k) {
    const { ctx, cx, cy, R } = this;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R - 3, 0, Math.PI * 2); ctx.clip();
    const vg = ctx.createRadialGradient(cx, cy + R, 0, cx, cy + R, R * 0.9);
    vg.addColorStop(0, `rgba(122,167,255,${0.4 * k})`);
    vg.addColorStop(1, "rgba(122,167,255,0)");
    ctx.fillStyle = vg;
    ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    // rising air streaks
    ctx.strokeStyle = `rgba(200,220,255,${0.22 * k})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      const x = cx + (i - 4) * R * 0.2;
      const phase = ((now / 6 + i * 53) % (R * 1.6));
      const y0 = cy + R - phase;
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x + Math.sin(i + now / 300) * 4, y0 - R * 0.22); ctx.stroke();
    }
    ctx.restore();
    // vent at the bottom
    ctx.fillStyle = "#3a3c6b";
    ctx.fillRect(cx - R * 0.28, cy + R - 6, R * 0.56, 8);
  }

  drawStand() {
    const { ctx, cx, cy, R, h } = this;
    ctx.fillStyle = "#24264a";
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.35, cy + R * 0.92);
    ctx.lineTo(cx + R * 0.35, cy + R * 0.92);
    ctx.lineTo(cx + R * 0.62, h - 8);
    ctx.lineTo(cx - R * 0.62, h - 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffcc33";
    ctx.fillRect(cx - R * 0.7, h - 14, R * 1.4, 7);
  }

  drawRimAndCap() {
    const { ctx, cx, cy, R } = this;
    const top = -Math.PI / 2;
    const a = this.doorAng;
    const dh = this.doorHalf;
    const br = Math.max(this.ballR, 8);

    ctx.lineWidth = 4;
    ctx.strokeStyle = "#ffcc33";
    ctx.beginPath(); ctx.arc(cx, cy, R, top + a, top - a + Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, Math.PI * 1.1, Math.PI * 1.35); ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(cx - dh, this.neckTop, dh * 2, this.neckBottom - this.neckTop);
    ctx.strokeStyle = "#ffcc33";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - dh, this.neckBottom); ctx.lineTo(cx - dh, this.neckTop);
    ctx.moveTo(cx + dh, this.neckBottom); ctx.lineTo(cx + dh, this.neckTop);
    ctx.stroke();

    const hingeX = cx - dh - 4, hingeY = this.neckTop;
    ctx.save();
    ctx.translate(hingeX, hingeY);
    ctx.rotate(-this.lid * (Math.PI * 0.62));
    const capW = dh * 2 + 8, capH = Math.max(7, br * 0.5);
    const cg = ctx.createLinearGradient(0, -capH, 0, 0);
    cg.addColorStop(0, "#ffe27a");
    cg.addColorStop(1, "#d9a400");
    ctx.fillStyle = cg;
    roundRect(ctx, 0, -capH, capW, capH, 4);
    ctx.fill();
    ctx.fillStyle = "#b88a00";
    ctx.fillRect(capW / 2 - 4, -capH - 4, 8, 4);
    ctx.restore();
    ctx.fillStyle = "#b88a00";
    ctx.beginPath(); ctx.arc(hingeX, hingeY - 2, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  drawCount(n, frac) {
    const { ctx, cx, cy, R } = this;
    const pop = frac < 0.25 ? easeOutBack(frac / 0.25) : 1;
    const fade = frac > 0.88 ? 1 - (frac - 0.88) / 0.12 : 1;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = "rgba(15,16,32,0.82)";
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.42 * pop, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#ffcc33";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.42 * pop, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - frac));
    ctx.stroke();
    ctx.fillStyle = "#ffcc33";
    ctx.shadowColor = "rgba(255,204,51,0.7)";
    ctx.shadowBlur = 20;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `900 ${R * 0.5 * pop}px ${FONT}`;
    ctx.fillText(String(n), cx, cy + R * 0.02);
    ctx.restore();
  }

  drawBall(x, y, r, color, name, rot, big) {
    const { ctx } = this;
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.35, color);
    g.addColorStop(1, shade(color, -0.35));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = "#14122a";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (big) {
      const words = String(name).split(" ");
      let size = r * 0.36;
      let lines;
      for (;;) {
        ctx.font = `800 ${size}px ${FONT}`;
        lines = wrap(ctx, words, r * 1.55);
        if ((lines.length * size * 1.15 <= r * 1.3 && lines.every((l) => ctx.measureText(l).width <= r * 1.6)) || size < 10) break;
        size *= 0.9;
      }
      lines.forEach((l, i) => ctx.fillText(l, x, y + (i - (lines.length - 1) / 2) * size * 1.15));
    } else if (r >= 12) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      let label = String(name).split(" ")[0];
      let size = r * 0.58;
      ctx.font = `700 ${size}px ${FONT}`;
      while (ctx.measureText(label).width > r * 1.7 && size > 7) {
        size *= 0.9;
        ctx.font = `700 ${size}px ${FONT}`;
      }
      if (ctx.measureText(label).width > r * 1.7) label = label.slice(0, 5) + "…";
      ctx.fillText(label, 0, 1);
      ctx.restore();
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx, words, maxW) {
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(c + (amt < 0 ? c * amt : (255 - c) * amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// List of picks: "Draw 1 – Name". Picks belonging to a draw that is still animating are hidden.
export function picksHTML(picks, hiddenSpinId) {
  const shown = (picks || []).filter((p) => p.spinId !== hiddenSpinId);
  if (!shown.length) return `<p class="muted center" style="font-size:14px">No names drawn yet.</p>`;
  return `<ol class="picks">${shown
    .map((p) => `<li><span class="pick-no">Draw ${p.no}</span><span class="pick-name">${escHtml(p.name)}</span></li>`)
    .join("")}</ol>`;
}

// Result bars (used for showing results on staff phones).
export function barsHTML(rows) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  const top = rows.length && rows[0][1] > 0 ? rows[0][1] : -1;
  return rows.map(([n, k]) => `
    <div class="bar-row ${k === top ? "leader" : ""}">
      <div class="bar-label"><span>${escHtml(n)}</span><span>${k}</span></div>
      <div class="bar"><span style="width:${(k / max) * 100}%"></span></div>
    </div>`).join("");
}

// Keeps a DrawMachine in sync with the shared draw document.
export function syncDraw(machine, picksEl, titleEl) {
  let lastSpinId = null;
  let first = true;
  let hidden = null;
  let latest = null;
  const paintPicks = () => {
    if (picksEl) picksEl.innerHTML = picksHTML(latest?.picks, hidden);
  };
  machine.onReveal = () => { hidden = null; paintPicks(); };

  return function update(data) {
    latest = data || {};
    if (titleEl) titleEl.textContent = latest.title || "Lucky Draw";
    const picked = new Set((latest.picks || []).map((p) => p.name));
    const spin = latest.spin;

    if (spin && spin.id !== lastSpinId) {
      lastSpinId = spin.id;
      let offset = 0;
      if (first && spin.at && spin.at.toMillis) offset = Math.max(0, Date.now() - spin.at.toMillis());
      hidden = offset < revealTime(spin) ? spin.id : null;
      machine.startSpin(spin, offset);
    } else if (!spin) {
      lastSpinId = null;
      hidden = null;
      machine.setPool((latest.pool || []).filter((n) => !picked.has(n)));
      machine.idle();
    }
    first = false;
    paintPicks();
  };
}
