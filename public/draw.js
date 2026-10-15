// ─────────────────────────────────────────────────────────────
//  KOVELI Awards – lucky draw machine (ping-pong balls in a globe)
//  Shared by index.html (staff) and admin.html.
// ─────────────────────────────────────────────────────────────

export const DRAW_MS = 9000; // total animation length of one draw

const COLORS = ["#ffcc33", "#ff5c8a", "#7aa7ff", "#3ddc97", "#ff9f43", "#c38bff", "#4dd9e8", "#f4f4fb"];
const MAX_BALLS = 40;

const escHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

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
    this.mode = "idle";        // idle | spin | reveal
    this.spin = null;          // {winner, start, duration}
    this.revealName = null;
    this.onReveal = null;
    this.t0 = performance.now();
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
    const h = Math.min(Math.round(w * 0.9), 520);
    this.canvas.style.height = h + "px";
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const oldR = this.R;
    this.w = w; this.h = h;
    this.R = Math.min(w, h) * 0.38;
    this.cx = w / 2;
    this.cy = h * 0.5;
    if (oldR && this.balls.length) {
      const k = this.R / oldR;
      this.balls.forEach((b) => { b.x = this.cx + (b.x - this.cx) * k; b.y = this.cy + (b.y - this.cy) * k; });
    }
    this.ballR = this.calcBallR(this.balls.length || 12);
    this.balls.forEach((b) => (b.r = this.ballR));
  }

  calcBallR(n) {
    return Math.max(11, Math.min(this.R * 0.2, (this.R * 0.95) / Math.sqrt(Math.max(n, 1) * 1.35)));
  }

  // Show these names as balls resting in the globe.
  setPool(names, keepWinner) {
    let list = [...names];
    if (list.length > MAX_BALLS) {
      // show a random subset, but always include the winner if there is one
      const keep = keepWinner && list.includes(keepWinner) ? [keepWinner] : [];
      const rest = list.filter((n) => n !== keepWinner).sort(() => Math.random() - 0.5).slice(0, MAX_BALLS - keep.length);
      list = [...keep, ...rest];
    }
    const same = list.length === this.names.length && list.every((n, i) => n === this.names[i]);
    if (same) return;
    this.names = list;
    this.ballR = this.calcBallR(list.length);
    const old = new Map(this.balls.map((b) => [b.name, b]));
    this.balls = list.map((name, i) => {
      const o = old.get(name);
      if (o) return { ...o, r: this.ballR, scale: 1, out: false };
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * (this.R - this.ballR) * 0.8;
      return {
        name, color: COLORS[i % COLORS.length],
        x: this.cx + Math.cos(a) * d, y: this.cy + Math.sin(a) * d,
        vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2,
        r: this.ballR, scale: 1, out: false, spin: Math.random() * Math.PI,
      };
    });
  }

  // Start an animated draw. offsetMs = how far into the animation we already are (late joiners).
  startSpin(pool, winner, offsetMs = 0, duration = DRAW_MS) {
    this.setPool(pool, winner);
    if (!this.balls.some((b) => b.name === winner)) this.setPool([winner, ...pool], winner);
    this.balls.forEach((b) => { b.out = false; b.scale = 1; });
    this.revealName = null;
    if (offsetMs >= duration * 0.85) return this.showWinner(winner);
    this.mode = "spin";
    this.spin = { winner, start: performance.now() - offsetMs, duration, revealed: false };
  }

  showWinner(name) {
    this.mode = "reveal";
    this.spin = null;
    this.revealName = name;
    this.balls.forEach((b) => { b.out = b.name === name; });
  }

  idle() {
    this.mode = "idle";
    this.spin = null;
    this.revealName = null;
    this.balls.forEach((b) => { b.out = false; b.scale = 1; });
  }

  // ───────── physics ─────────
  step(mixing) {
    const { cx, cy, R } = this;
    const live = this.balls.filter((b) => !b.out);
    const k = R / 150; // scale physics to canvas size
    for (const b of live) {
      if (mixing) {
        // air blower: strong random kicks, mostly upward from the bottom
        if (b.y > cy) b.vy -= (0.6 + Math.random() * 1.6) * k;
        b.vx += (Math.random() - 0.5) * 1.6 * k;
        b.vy += (Math.random() - 0.5) * 1.2 * k;
        // swirl
        const dx = b.x - cx, dy = b.y - cy;
        b.vx += (-dy / R) * 0.35 * k;
        b.vy += (dx / R) * 0.35 * k;
        b.vy += 0.25 * k;
        b.vx *= 0.985; b.vy *= 0.985;
      } else {
        b.vy += 0.35 * k;            // gravity
        b.vx *= 0.97; b.vy *= 0.985;
      }
      const max = (mixing ? 9 : 6) * k;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > max) { b.vx *= max / sp; b.vy *= max / sp; }
      b.x += b.vx; b.y += b.vy;
      b.spin += b.vx * 0.04;

      // globe wall
      const dx = b.x - cx, dy = b.y - cy;
      const d = Math.hypot(dx, dy);
      const lim = R - b.r - 3;
      if (d > lim) {
        const nx = dx / d, ny = dy / d;
        b.x = cx + nx * lim; b.y = cy + ny * lim;
        const vn = b.vx * nx + b.vy * ny;
        if (vn > 0) { b.vx -= (1.6) * vn * nx; b.vy -= (1.6) * vn * ny; }
      }
    }
    // ball–ball collisions
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], c = live[j];
        const dx = c.x - a.x, dy = c.y - a.y;
        const min = a.r + c.r;
        const d2 = dx * dx + dy * dy;
        if (d2 > 0 && d2 < min * min) {
          const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, ov = (min - d) / 2;
          a.x -= nx * ov; a.y -= ny * ov; c.x += nx * ov; c.y += ny * ov;
          const rel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
          if (rel < 0) {
            const imp = -rel * 0.9;
            a.vx -= imp * nx; a.vy -= imp * ny; c.vx += imp * nx; c.vy += imp * ny;
          }
        }
      }
    }
  }

  loop(now) {
    this.raf = requestAnimationFrame(this._loop);
    const { ctx } = this;
    let mixing = false;
    let wb = null; // winner ball being extracted
    let extractT = 0;

    if (this.mode === "spin" && this.spin) {
      const p = (now - this.spin.start) / this.spin.duration;
      mixing = p < 0.68;
      if (p >= 0.68) {
        wb = this.balls.find((b) => b.name === this.spin.winner);
        extractT = clamp01((p - 0.68) / 0.17);
        if (wb && !wb.out) { wb.out = true; wb.sx = wb.x; wb.sy = wb.y; }
      }
      if (p >= 0.85 && !this.spin.revealed) {
        this.spin.revealed = true;
        const name = this.spin.winner;
        this.showWinner(name);
        this.revealAt = now;
        if (this.onReveal) this.onReveal(name);
      }
    }
    this.step(mixing);

    // ───────── draw ─────────
    const { w, h, cx, cy, R } = this;
    ctx.clearRect(0, 0, w, h);

    // stand
    ctx.fillStyle = "#24264a";
    ctx.beginPath();
    ctx.moveTo(cx - R * 0.35, cy + R * 0.92);
    ctx.lineTo(cx + R * 0.35, cy + R * 0.92);
    ctx.lineTo(cx + R * 0.6, h - 6);
    ctx.lineTo(cx - R * 0.6, h - 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#ffcc33";
    ctx.fillRect(cx - R * 0.66, h - 12, R * 1.32, 6);

    // globe glass
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    g.addColorStop(0, "rgba(255,255,255,0.16)");
    g.addColorStop(1, "rgba(122,167,255,0.06)");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();

    // balls inside
    for (const b of this.balls) if (!b.out) this.drawBall(b.x, b.y, b.r, b.color, b.name, b.spin, false);

    // glass rim + shine + exit hole on top
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#ffcc33";
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.86, Math.PI * 1.1, Math.PI * 1.4); ctx.stroke();
    ctx.fillStyle = "#ffcc33";
    ctx.fillRect(cx - this.ballR * 1.3, cy - R - 10, this.ballR * 2.6, 12);

    // winner ball travelling out of the top, then growing in the middle
    if (wb && this.mode === "spin") {
      const t = ease(extractT);
      const topY = cy - R - this.ballR * 1.6;
      let x, y, r;
      if (t < 0.5) {
        const u = t / 0.5;
        x = wb.sx + (cx - wb.sx) * u;
        y = wb.sy + (topY - wb.sy) * u;
        r = wb.r;
      } else {
        const u = (t - 0.5) / 0.5;
        x = cx;
        y = topY + (cy - topY) * u;
        r = wb.r + (R * 0.62 - wb.r) * u;
      }
      this.drawBall(x, y, r, wb.color, wb.name, 0, r > wb.r * 2);
    }

    // revealed winner
    if (this.mode === "reveal" && this.revealName) {
      const wball = this.balls.find((b) => b.name === this.revealName);
      const pulse = 1 + Math.sin((now - (this.revealAt || now)) / 260) * 0.025;
      ctx.fillStyle = "rgba(15,16,32,0.55)";
      ctx.beginPath(); ctx.arc(cx, cy, R - 2, 0, Math.PI * 2); ctx.fill();
      ctx.save();
      ctx.shadowColor = "rgba(255,204,51,0.8)";
      ctx.shadowBlur = 40;
      this.drawBall(cx, cy, R * 0.62 * pulse, wball ? wball.color : "#ffcc33", this.revealName, 0, true);
      ctx.restore();
    }
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
      // full name, wrapped to fit the big ball
      const words = String(name).split(" ");
      let size = r * 0.36;
      let lines;
      for (;;) {
        ctx.font = `800 ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
        lines = wrap(ctx, words, r * 1.55);
        if ((lines.length * size * 1.15 <= r * 1.3 && lines.every((l) => ctx.measureText(l).width <= r * 1.6)) || size < 10) break;
        size *= 0.9;
      }
      lines.forEach((l, i) => ctx.fillText(l, x, y + (i - (lines.length - 1) / 2) * size * 1.15));
    } else if (r >= 13) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.sin(rot) * 0.5);
      let label = String(name).split(" ")[0];
      let size = r * 0.58;
      ctx.font = `700 ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      while (ctx.measureText(label).width > r * 1.7 && size > 7) {
        size *= 0.9;
        ctx.font = `700 ${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
      }
      if (ctx.measureText(label).width > r * 1.7) label = label.slice(0, 5) + "…";
      ctx.fillText(label, 0, 1);
      ctx.restore();
    }
  }
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
      if (offset < DRAW_MS * 0.85) hidden = spin.id;
      machine.startSpin(spin.pool || [], spin.winner, offset, DRAW_MS);
    } else if (!spin) {
      lastSpinId = null;
      hidden = null;
      machine.setPool((latest.pool || []).filter((n) => !picked.has(n)));
      machine.idle();
    } else if (machine.mode === "reveal" && !hidden) {
      // same spin, other change (e.g. pool edited) – keep showing the winner
    }
    first = false;
    paintPicks();
  };
}
