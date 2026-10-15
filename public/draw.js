// ─────────────────────────────────────────────────────────────
//  KOVELI Awards – lucky draw machine (ping-pong balls in a bowl)
//  Shared by index.html (staff) and admin.html.
//
//  Timeline of one draw (ms):
//     0 – 6000   balls swirl in the bowl
//  6000 – 9000   big 3 · 2 · 1 countdown (balls still swirling)
//  ~7600 – 8800  the drawn ball settles at the doorstep under the cap
//  9000          cap opens
//  9400 – 10000  ball pops out through the cap
//  10000 – 10400 cap closes
//  10000 – 11000 ball flies to the middle and grows
//  11000         name revealed
// ─────────────────────────────────────────────────────────────

export const DRAW_MS = 12000;   // whole animation
export const REVEAL_MS = 11000; // when the name is shown

const T = {
  countdown: 6000,
  steer: 6000,
  hold: 7600,
  open: 9000,
  opened: 9400,
  out: 10000,
  closed: 10400,
  reveal: REVEAL_MS,
};

const COLORS = ["#ffcc33", "#ff5c8a", "#7aa7ff", "#3ddc97", "#ff9f43", "#c38bff", "#4dd9e8", "#f4f4fb"];
const MAX_BALLS = 40;
const FONT = "system-ui, -apple-system, Segoe UI, Roboto, sans-serif";

const escHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOutBack = (t) => { const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const prog = (e, a, b) => clamp01((e - a) / (b - a));

// Cryptographically fair random index (used by the admin when drawing).
export function fairIndex(n) {
  const a = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do { crypto.getRandomValues(a); } while (a[0] >= limit);
  return a[0] % n;
}

export class DrawMachine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.balls = [];
    this.names = [];
    this.mode = "idle";      // idle | spin | reveal
    this.spin = null;        // { winner, start }
    this.revealName = null;
    this.onReveal = null;
    this.lid = 0;            // 0 = closed, 1 = fully open
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
    const h = Math.min(Math.round(w * 0.95), 560);
    this.canvas.style.height = h + "px";
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const oldR = this.R, ocx = this.cx, ocy = this.cy;
    this.w = w; this.h = h;
    this.R = Math.min(w, h) * 0.36;
    this.cx = w / 2;
    this.cy = h * 0.56;
    if (oldR && this.balls.length) {
      const k = this.R / oldR;
      this.balls.forEach((b) => { b.x = this.cx + (b.x - ocx) * k; b.y = this.cy + (b.y - ocy) * k; });
    }
    this.ballR = this.calcBallR(this.balls.length || 12);
    this.balls.forEach((b) => (b.r = this.ballR));
    this.geom();
  }

  // door / neck / cap geometry
  geom() {
    const { cx, cy, R } = this;
    this.doorHalf = this.ballR * 1.35;
    this.doorAng = Math.asin(Math.min(0.9, this.doorHalf / R));
    this.neckBottom = cy - R * Math.cos(this.doorAng);
    this.neckTop = this.neckBottom - this.ballR * 1.7;
    this.doorstep = { x: cx, y: cy - R + this.ballR + 4 };
    this.exitY = this.neckTop - this.ballR - 6;
  }

  calcBallR(n) {
    return Math.max(10, Math.min(this.R * 0.19, (this.R * 0.92) / Math.sqrt(Math.max(n, 1) * 1.35)));
  }

  // Show these names as balls resting in the bowl.
  setPool(names, keepWinner) {
    let list = [...names];
    if (list.length > MAX_BALLS) {
      const keep = keepWinner && list.includes(keepWinner) ? [keepWinner] : [];
      const rest = list.filter((n) => n !== keepWinner).sort(() => Math.random() - 0.5).slice(0, MAX_BALLS - keep.length);
      list = [...keep, ...rest];
    }
    const same = list.length === this.names.length && list.every((n, i) => n === this.names[i]);
    if (same) return;
    this.names = list;
    this.ballR = this.calcBallR(list.length);
    this.geom();
    const old = new Map(this.balls.map((b) => [b.name, b]));
    this.balls = list.map((name, i) => {
      const o = old.get(name);
      if (o) return { ...o, r: this.ballR, held: false, out: false };
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * (this.R - this.ballR) * 0.8;
      return {
        name, color: COLORS[i % COLORS.length],
        x: this.cx + Math.cos(a) * d, y: this.cy + Math.abs(Math.sin(a)) * d * 0.8,
        vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
        r: this.ballR, held: false, out: false, rot: Math.random() * Math.PI,
      };
    });
  }

  // Start an animated draw. offsetMs = how far into the animation we already are (late joiners).
  startSpin(pool, winner, offsetMs = 0) {
    this.setPool(pool, winner);
    if (!this.balls.some((b) => b.name === winner)) this.setPool([winner, ...pool], winner);
    this.balls.forEach((b) => { b.out = false; b.held = false; });
    this.revealName = null;
    this.lid = 0;
    if (offsetMs >= REVEAL_MS) return this.showWinner(winner);
    this.mode = "spin";
    this.spin = { winner, start: performance.now() - offsetMs, revealed: false };
  }

  showWinner(name) {
    this.mode = "reveal";
    this.spin = null;
    this.revealName = name;
    this.lid = 0;
    this.balls.forEach((b) => { b.out = b.name === name; b.held = false; });
    if (!this.revealAt) this.revealAt = performance.now();
  }

  idle() {
    this.mode = "idle";
    this.spin = null;
    this.revealName = null;
    this.lid = 0;
    this.balls.forEach((b) => { b.out = false; b.held = false; });
  }

  // ───────── physics ─────────
  step(blow, steerTo, steerK) {
    const { cx, cy, R } = this;
    const k = R / 150; // scale physics to canvas size
    const live = this.balls.filter((b) => !b.out);
    for (const b of live) {
      if (b.held) continue;
      if (blow > 0) {
        // air from the bottom: strong random kicks, mostly upward
        if (b.y > cy - R * 0.2) b.vy -= (0.5 + Math.random() * 1.8) * k * blow;
        b.vx += (Math.random() - 0.5) * 1.8 * k * blow;
        b.vy += (Math.random() - 0.5) * 1.2 * k * blow;
        // swirl around the bowl
        const dx = b.x - cx, dy = b.y - cy;
        b.vx += (-dy / R) * 0.45 * k * blow;
        b.vy += (dx / R) * 0.45 * k * blow;
      }
      b.vy += 0.32 * k; // gravity
      if (steerTo && b.isWinner) {
        b.vx += (steerTo.x - b.x) * 0.012 * steerK;
        b.vy += (steerTo.y - b.y) * 0.012 * steerK;
        b.vx *= 1 - 0.08 * steerK; b.vy *= 1 - 0.08 * steerK;
      }
      b.vx *= blow > 0 ? 0.985 : 0.97;
      b.vy *= 0.985;
      const max = (blow > 0 ? 10 : 6) * k;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
      b.x += b.vx; b.y += b.vy;
      b.rot += b.vx * 0.05;

      // bowl wall
      const dx = b.x - cx, dy = b.y - cy;
      const d = Math.hypot(dx, dy);
      const lim = R - b.r - 3;
      if (d > lim) {
        const nx = dx / d, ny = dy / d;
        b.x = cx + nx * lim; b.y = cy + ny * lim;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) { b.vx -= 1.65 * vn * nx; b.vy -= 1.65 * vn * ny; }
      }
    }
    // ball–ball collisions (a held ball doesn't move: it pushes others away)
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], c = live[j];
        const dx = c.x - a.x, dy = c.y - a.y;
        const min = a.r + c.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = min - d;
          const wa = a.held ? 0 : c.held ? 1 : 0.5;
          const wc = 1 - wa;
          a.x -= nx * ov * wa; a.y -= ny * ov * wa;
          c.x += nx * ov * wc; c.y += ny * ov * wc;
          const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (rel < 0) {
            const imp = -rel * 0.9;
            if (!a.held) { a.vx -= imp * nx * (c.held ? 2 : 1); a.vy -= imp * ny * (c.held ? 2 : 1); }
            if (!c.held) { c.vx += imp * nx * (a.held ? 2 : 1); c.vy += imp * ny * (a.held ? 2 : 1); }
          }
        }
      }
    }
  }

  loop(now) {
    this.raf = requestAnimationFrame(this._loop);
    const { ctx } = this;

    let blow = 0, steerTo = null, steerK = 0;
    let wb = null, e = 0, count = 0, countFrac = 0;

    if (this.mode === "spin" && this.spin) {
      e = now - this.spin.start;
      wb = this.balls.find((b) => b.name === this.spin.winner);
      this.balls.forEach((b) => (b.isWinner = b === wb));

      // blower: full power, easing off just before the cap opens
      blow = e < T.hold ? 1 : e < T.open ? 1 - prog(e, T.hold, T.open) * 0.85 : 0;

      // the drawn ball drifts toward the doorstep during the countdown
      if (wb && e >= T.steer && e < T.hold) { steerTo = this.doorstep; steerK = prog(e, T.steer, T.hold); }
      if (wb && e >= T.hold && !wb.held && !wb.out) { wb.held = true; wb.hx = wb.x; wb.hy = wb.y; }

      // countdown 3 · 2 · 1
      if (e >= T.countdown && e < T.open) {
        const s = (e - T.countdown) / 1000;
        count = 3 - Math.floor(s);
        countFrac = s - Math.floor(s);
      }

      // cap
      this.lid = e < T.open ? 0 : e < T.opened ? easeOutBack(prog(e, T.open, T.opened)) : e < T.out ? 1 : 1 - easeInOut(prog(e, T.out, T.closed));

      if (e >= REVEAL_MS && !this.spin.revealed) {
        this.spin.revealed = true;
        const name = this.spin.winner;
        this.revealAt = now;
        this.showWinner(name);
        if (this.onReveal) this.onReveal(name);
      }
    } else {
      this.balls.forEach((b) => (b.isWinner = false));
    }

    // held ball glides onto the doorstep
    if (wb && wb.held && this.mode === "spin") {
      const t = easeInOut(prog(e, T.hold, T.open - 200));
      wb.x = wb.hx + (this.doorstep.x - wb.hx) * t;
      wb.y = wb.hy + (this.doorstep.y - wb.hy) * t;
      wb.vx = wb.vy = 0;
      if (e >= T.opened) { wb.out = true; wb.held = false; }
    }

    this.step(blow, steerTo, steerK);

    // ───────── draw ─────────
    const { w, h, cx, cy, R } = this;
    ctx.clearRect(0, 0, w, h);

    this.drawStand();

    // bowl glass
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    g.addColorStop(0, "rgba(255,255,255,0.16)");
    g.addColorStop(1, "rgba(122,167,255,0.06)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // air vent glow at the bottom while blowing
    if (blow > 0) {
      const vg = ctx.createRadialGradient(cx, cy + R, 0, cx, cy + R, R * 0.7);
      vg.addColorStop(0, `rgba(122,167,255,${0.35 * blow})`);
      vg.addColorStop(1, "rgba(122,167,255,0)");
      ctx.fillStyle = vg;
      ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, Math.PI * 2); ctx.fill();
    }

    // balls inside
    for (const b of this.balls) if (!b.out) this.drawBall(b.x, b.y, b.r, b.color, b.name, b.rot, false);

    // winner travelling out through the neck (drawn before the neck so it looks inside the tube)
    let flying = null;
    if (wb && wb.out && this.mode === "spin") {
      if (e < T.out) {
        const t = easeInOut(prog(e, T.opened, T.out));
        this.drawBall(cx, this.doorstep.y + (this.exitY - this.doorstep.y) * t, wb.r, wb.color, wb.name, 0, false);
      } else {
        flying = prog(e, T.out, REVEAL_MS);
      }
    }

    this.drawRimAndCap();

    // dim the bowl and grow the winner in the middle
    if (flying !== null && wb) {
      const t = easeInOut(flying);
      ctx.fillStyle = `rgba(15,16,32,${0.55 * t})`;
      ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, Math.PI * 2); ctx.fill();
      // up and out to the side (so the closing cap stays visible), then into the middle
      const side = Math.sin(t * Math.PI) * R * 0.75;
      const x = cx + side;
      const y = this.exitY + (cy - this.exitY) * t - Math.sin(t * Math.PI) * R * 0.15;
      const r = wb.r + (R * 0.66 - wb.r) * t;
      this.drawBall(x, y, r, wb.color, wb.name, 0, r > wb.r * 2.2);
    }

    // countdown
    if (count > 0) this.drawCount(count, countFrac);

    // revealed winner
    if (this.mode === "reveal" && this.revealName) {
      const wball = this.balls.find((b) => b.name === this.revealName);
      const pulse = 1 + Math.sin((now - (this.revealAt || now)) / 260) * 0.025;
      ctx.fillStyle = "rgba(15,16,32,0.55)";
      ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.shadowColor = "rgba(255,204,51,0.85)";
      ctx.shadowBlur = 40;
      this.drawBall(cx, cy, R * 0.66 * pulse, wball ? wball.color : "#ffcc33", this.revealName, 0, true);
      ctx.restore();
    }
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

    // rim with a gap for the door
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#ffcc33";
    ctx.beginPath(); ctx.arc(cx, cy, R, top + a, top - a + Math.PI * 2); ctx.stroke();
    // glass shine
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, Math.PI * 1.1, Math.PI * 1.35); ctx.stroke();

    // neck (glass tube)
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(cx - dh, this.neckTop, dh * 2, this.neckBottom - this.neckTop);
    ctx.strokeStyle = "#ffcc33";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - dh, this.neckBottom); ctx.lineTo(cx - dh, this.neckTop);
    ctx.moveTo(cx + dh, this.neckBottom); ctx.lineTo(cx + dh, this.neckTop);
    ctx.stroke();

    // cap, hinged on the left of the neck
    const hingeX = cx - dh - 4, hingeY = this.neckTop;
    const ang = -this.lid * (Math.PI * 0.62);
    ctx.save();
    ctx.translate(hingeX, hingeY);
    ctx.rotate(ang);
    const capW = dh * 2 + 8, capH = Math.max(7, this.ballR * 0.5);
    const cg = ctx.createLinearGradient(0, -capH, 0, 0);
    cg.addColorStop(0, "#ffe27a");
    cg.addColorStop(1, "#d9a400");
    ctx.fillStyle = cg;
    roundRect(ctx, 0, -capH, capW, capH, 4);
    ctx.fill();
    ctx.fillStyle = "#b88a00";
    ctx.fillRect(capW / 2 - 4, -capH - 4, 8, 4); // knob
    ctx.restore();
    // hinge pin
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
    // ring that empties over the second
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
      ctx.rotate(Math.sin(rot) * 0.5);
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
// Returns a function to call with each new snapshot of draw/current.
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
      // How far into the animation are we? (only matters for someone opening the page late)
      let offset = 0;
      if (first && spin.at && spin.at.toMillis) offset = Math.max(0, Date.now() - spin.at.toMillis());
      hidden = offset < REVEAL_MS ? spin.id : null;
      machine.startSpin(spin.pool || [], spin.winner, offset);
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
