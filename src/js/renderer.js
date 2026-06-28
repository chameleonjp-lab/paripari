// Canvas 2D 描画 要件 §4.4 §6.4
// ビジュアル/演出強化版: タイミングリング・方向受け流し・衝撃波・スコアポップ・
// コンボオーラ・背景アンビエント。
import { CONFIG } from './config.js';
import { attackProgress } from './enemy.js';

const PLAYER_R = 27;
const DIR_ANGLE = { R: 0, D: Math.PI / 2, L: Math.PI, U: -Math.PI / 2 };

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
    this.lineY = 0;
    this.t = 0;
    this.reducedMotion = false;

    // 全画面フラッシュ / シェイク
    this.flash = 0; this.flashColor = '#fff';
    this.shake = 0;
    this.vignette = 0; this.vignetteColor = '60,90,160';

    // 透過的な演出要素
    this.shockwaves = [];   // {x,y,t,dur,max,color,width}
    this.popups = [];       // {x,y,vy,t,dur,text,color,size}
    this.deflect = null;    // {dir,t,dur,color,result}
    this.embers = [];

    this.resize();
    this._initEmbers();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, CONFIG.DPR_CAP);
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.lineY = this.h * 0.54;
  }

  _initEmbers() {
    const n = 30;
    this.embers = [];
    for (let i = 0; i < n; i++) {
      this.embers.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        vy: -8 - Math.random() * 16,
        vx: (Math.random() - 0.5) * 6,
        r: 0.6 + Math.random() * 1.8,
        a: 0.15 + Math.random() * 0.35,
        ph: Math.random() * Math.PI * 2,
      });
    }
  }

  // ---- 演出トリガ（game から呼ばれる）----
  triggerFlash(color, intensity = 1) { this.flash = Math.max(this.flash, intensity); this.flashColor = color; }
  triggerShake(px) { if (!this.reducedMotion) this.shake = Math.max(this.shake, px); }
  triggerVignette(color, intensity) { this.vignette = Math.max(this.vignette, intensity); this.vignetteColor = color; }

  triggerShockwave(result) {
    const color = result === 'PERFECT' ? '255,220,120' : result === 'GOOD' ? '120,220,255' : '255,70,90';
    const max = result === 'PERFECT' ? this.w * 0.9 : result === 'GOOD' ? this.w * 0.6 : this.w * 0.5;
    this.shockwaves.push({ x: this.w / 2, y: this.lineY, t: 0, dur: result === 'PERFECT' ? 0.6 : 0.42, max, color, width: result === 'MISS' ? 3 : 5 });
    if (result === 'PERFECT') {
      // 二重リング
      this.shockwaves.push({ x: this.w / 2, y: this.lineY, t: -0.06, dur: 0.7, max: this.w * 1.15, color, width: 2 });
    }
  }

  triggerDeflect(dir, result) {
    this.deflect = { dir, t: 0, dur: 0.26, result, color: result === 'PERFECT' ? '#fff2c0' : '#bfefff' };
  }

  addScorePopup(amount, result) {
    if (amount <= 0) return;
    const color = result === 'PERFECT' ? '#ffd35b' : '#bfefff';
    this.popups.push({
      x: this.w / 2 + (Math.random() - 0.5) * 30,
      y: this.lineY - PLAYER_R - 18,
      vy: -64, t: 0, dur: 0.85,
      text: '+' + amount, color,
      size: result === 'PERFECT' ? 26 : 20,
    });
  }

  // ---- メイン描画 ----
  draw(dt, state, particles) {
    const ctx = this.ctx;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 5.5);
    this.shake = Math.max(0, this.shake - dt * 70);
    this.vignette = Math.max(0, this.vignette - dt * 2.8);
    this._updateTransients(dt);

    ctx.save();
    if (this.shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    this._drawBackground(ctx, dt);
    this._drawParryLine(ctx);

    const combo = state.combo || 0;
    this._drawComboAura(ctx, combo);
    this._drawShockwaves(ctx);

    // 攻撃（タイミングリング＋接近する斬撃）
    if (state.attack && !state.attack.resolved) {
      this._drawTimingRing(ctx, state.attack, state.now);
      this._drawAttack(ctx, state.attack, state.now);
    } else if (state.attack && state.attack.resolved && state.now - state.attack.resolvedAt < 220) {
      this._drawResolved(ctx, state.attack, state.now);
    }

    this._drawPlayer(ctx, combo);
    this._drawDeflect(ctx);
    particles.draw(ctx);
    this._drawPopups(ctx);
    ctx.restore();

    this._drawVignette(ctx);
    if (this.flash > 0.01) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.9, this.flash);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }
  }

  _updateTransients(dt) {
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      this.shockwaves[i].t += dt;
      if (this.shockwaves[i].t >= this.shockwaves[i].dur) this.shockwaves.splice(i, 1);
    }
    for (let i = this.popups.length - 1; i >= 0; i--) {
      const p = this.popups[i];
      p.t += dt; p.y += p.vy * dt; p.vy *= (1 - dt * 1.6);
      if (p.t >= p.dur) this.popups.splice(i, 1);
    }
    if (this.deflect) { this.deflect.t += dt; if (this.deflect.t >= this.deflect.dur) this.deflect = null; }
  }

  // ---- 背景 ----
  _drawBackground(ctx, dt) {
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#0a0a18');
    g.addColorStop(0.55, '#11152e');
    g.addColorStop(1, '#06060e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // 中央の墨だまり（呼吸）
    const cx = this.w / 2, cy = this.lineY;
    const breathe = 0.16 + Math.sin(this.t * 1.4) * 0.05;
    const rg = ctx.createRadialGradient(cx, cy, 8, cx, cy, this.w * 0.75);
    rg.addColorStop(0, `rgba(60,90,180,${breathe})`);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, this.w, this.h);

    // 漂う火の粉
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of this.embers) {
      e.x += e.vx * dt; e.y += e.vy * dt; e.ph += dt * 2;
      if (e.y < -10) { e.y = this.h + 10; e.x = Math.random() * this.w; }
      if (e.x < -10) e.x = this.w + 10; else if (e.x > this.w + 10) e.x = -10;
      const a = e.a * (0.6 + 0.4 * Math.sin(e.ph));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#7fb0ff';
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawParryLine(ctx) {
    const y = this.lineY;
    ctx.save();
    const lg = ctx.createLinearGradient(0, 0, this.w, 0);
    lg.addColorStop(0, 'rgba(255,255,255,0)');
    lg.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    lg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = lg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(this.w, y); ctx.stroke();
    ctx.restore();
  }

  // ---- コンボオーラ ----
  _drawComboAura(ctx, combo) {
    if (combo < 2) return;
    const cx = this.w / 2, cy = this.lineY;
    const lvl = Math.min(combo / 30, 1);
    const hue = 190 - lvl * 150; // cyan → gold/orange
    const pulse = 1 + Math.sin(this.t * 6) * 0.06 * lvl;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const r = (PLAYER_R + 16 + lvl * 40) * pulse;
    const rg = ctx.createRadialGradient(cx, cy, PLAYER_R, cx, cy, r);
    rg.addColorStop(0, `hsla(${hue},100%,65%,${0.05 + lvl * 0.22})`);
    rg.addColorStop(1, `hsla(${hue},100%,55%,0)`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- タイミングリング（収束）----
  _drawTimingRing(ctx, attack, now) {
    const cx = this.w / 2, cy = this.lineY;
    const p = attackProgress(attack, now); // 0..(>1)
    const maxR = Math.min(this.w, this.h) * 0.42;
    // p=1 でプレイヤー外周(PLAYER_R)にちょうど一致
    const r = PLAYER_R + (maxR - PLAYER_R) * (1 - Math.min(p, 1));
    // 中心に近づくほど白→金。GOOD窓相当(残時間)で色づく
    const near = Math.max(0, 1 - Math.abs(1 - p) * 4);
    const col = `rgba(${255},${Math.round(255 - near * 40)},${Math.round(255 - near * 175)},`;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = col + (0.5 + near * 0.5) + ')';
    ctx.lineWidth = 2 + near * 2;
    ctx.shadowColor = col + '1)';
    ctx.shadowBlur = 10 + near * 16;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(r, PLAYER_R), 0, Math.PI * 2);
    ctx.stroke();
    // ターゲットの薄い基準リング（PERFECT帯）
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, PLAYER_R + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---- 攻撃（接近する斬撃＋トレイル）----
  attackStart(dir) {
    switch (dir) {
      case 'L': return { x: -40, y: this.lineY };
      case 'R': return { x: this.w + 40, y: this.lineY };
      case 'U': return { x: this.w / 2, y: -40 };
      case 'D': return { x: this.w / 2, y: this.h + 40 };
      default: return { x: this.w / 2, y: -40 };
    }
  }

  _drawAttack(ctx, attack, now) {
    const p = attackProgress(attack, now);
    const start = this.attackStart(attack.dir);
    const cx = this.w / 2, cy = this.lineY;
    const e = p * p; // ease-in

    const telGlow = Math.max(0, 1 - p) * 0.5 + 0.18;
    this._drawEdgeGlow(ctx, attack.dir, telGlow);
    this._drawIncomingArrow(ctx, attack.dir, telGlow, p);

    const angle = Math.atan2(cy - start.y, cx - start.x);
    const danger = p > 0.68;
    const col = danger ? '#ff3b54' : '#ff9a5b';

    // トレイル（残像）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let k = 1; k <= 3; k++) {
      const pe = Math.max(0, e - k * 0.05);
      const tx = start.x + (cx - start.x) * pe;
      const ty = start.y + (cy - start.y) * pe;
      ctx.globalAlpha = (0.12) * (1 - k / 4) * Math.min(1, p + 0.3);
      this._slash(ctx, tx, ty, angle, 50 + 30 * pe, col, 4);
    }
    ctx.restore();

    // 本体
    const x = start.x + (cx - start.x) * e;
    const y = start.y + (cy - start.y) * e;
    ctx.save();
    ctx.globalAlpha = Math.min(1, 0.4 + p);
    ctx.shadowColor = col; ctx.shadowBlur = 18;
    this._slash(ctx, x, y, angle, 62 + 42 * e, col, 5 + 6 * e);
    ctx.restore();
  }

  _slash(ctx, x, y, angle, len, color, width) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.lineTo(len / 2, 0);
    ctx.stroke();
    ctx.restore();
  }

  _drawResolved(ctx, attack, now) {
    const k = Math.max(0, Math.min(1, (now - attack.resolvedAt) / 220));
    const cx = this.w / 2, cy = this.lineY;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - k) * 0.8;
    ctx.strokeStyle = attack.result === 'MISS' ? '#ff3b54' : '#ffd35b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, PLAYER_R + k * 50, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // ---- プレイヤー（守りの構え）----
  _drawPlayer(ctx, combo) {
    const cx = this.w / 2, cy = this.lineY;
    const pulse = 1 + Math.sin(this.t * 3) * 0.04;
    ctx.save();
    ctx.strokeStyle = 'rgba(120,210,255,0.85)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(120,210,255,0.8)';
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.arc(cx, cy, PLAYER_R * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    // 内側コア
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 9);
    cg.addColorStop(0, '#ffffff');
    cg.addColorStop(1, 'rgba(180,230,255,0.6)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.arc(cx, cy, 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- 方向受け流し（成功時、反対側へ刀をフリック）----
  _drawDeflect(ctx) {
    if (!this.deflect) return;
    const d = this.deflect;
    const k = d.t / d.dur;            // 0..1
    const cx = this.w / 2, cy = this.lineY;
    const ang = DIR_ANGLE[d.dir] != null ? DIR_ANGLE[d.dir] : 0;
    const ease = 1 - Math.pow(1 - k, 3);
    const reach = PLAYER_R + 8 + ease * 64;
    const alpha = Math.max(0, 1 - k);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.globalCompositeOperation = 'lighter';
    // フリックする刀身
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = d.color;
    ctx.lineWidth = d.result === 'PERFECT' ? 6 : 4;
    ctx.lineCap = 'round';
    ctx.shadowColor = d.color; ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(PLAYER_R * 0.4, 0);
    ctx.lineTo(reach, 0);
    ctx.stroke();
    // 弧（受け流しの軌跡）
    ctx.globalAlpha = alpha * 0.8;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    const sweep = (0.5 + ease * 0.7);
    ctx.arc(0, 0, reach * 0.82, -sweep, sweep);
    ctx.stroke();
    ctx.restore();
  }

  _drawShockwaves(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.shockwaves) {
      const k = Math.max(0, s.t / s.dur);
      if (k <= 0) continue;
      const r = s.max * (1 - Math.pow(1 - k, 2));
      ctx.globalAlpha = Math.max(0, 1 - k) * 0.7;
      ctx.strokeStyle = `rgba(${s.color},1)`;
      ctx.lineWidth = s.width * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawPopups(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.popups) {
      const k = p.t / p.dur;
      ctx.globalAlpha = Math.max(0, 1 - k * k);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color; ctx.shadowBlur = 12;
      ctx.font = `800 ${p.size}px -apple-system, sans-serif`;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  _drawVignette(ctx) {
    if (this.vignette <= 0.01) return;
    const cx = this.w / 2, cy = this.h / 2;
    const rg = ctx.createRadialGradient(cx, cy, this.h * 0.25, cx, cy, this.h * 0.72);
    rg.addColorStop(0, `rgba(${this.vignetteColor},0)`);
    rg.addColorStop(1, `rgba(${this.vignetteColor},${Math.min(0.7, this.vignette)})`);
    ctx.save();
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();
  }

  _drawEdgeGlow(ctx, dir, a) {
    ctx.save();
    ctx.globalAlpha = a;
    const c = 'rgba(255,80,90,';
    let grad;
    if (dir === 'L') {
      grad = ctx.createLinearGradient(0, 0, this.w * 0.32, 0);
      grad.addColorStop(0, c + '0.6)'); grad.addColorStop(1, c + '0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, this.w * 0.32, this.h);
    } else if (dir === 'R') {
      grad = ctx.createLinearGradient(this.w, 0, this.w * 0.68, 0);
      grad.addColorStop(0, c + '0.6)'); grad.addColorStop(1, c + '0)');
      ctx.fillStyle = grad; ctx.fillRect(this.w * 0.68, 0, this.w * 0.32, this.h);
    } else if (dir === 'U') {
      grad = ctx.createLinearGradient(0, 0, 0, this.h * 0.32);
      grad.addColorStop(0, c + '0.6)'); grad.addColorStop(1, c + '0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, this.w, this.h * 0.32);
    } else {
      grad = ctx.createLinearGradient(0, this.h, 0, this.h * 0.68);
      grad.addColorStop(0, c + '0.6)'); grad.addColorStop(1, c + '0)');
      ctx.fillStyle = grad; ctx.fillRect(0, this.h * 0.68, this.w, this.h * 0.32);
    }
    ctx.restore();
  }

  // 攻撃が「来る方向」を示す矢印（答えではなく脅威の提示）
  _drawIncomingArrow(ctx, dir, a, p) {
    const cx = this.w / 2, cy = this.lineY;
    const off = 96 + Math.sin(this.t * 8) * 4;
    let x = cx, y = cy, ch = '◀';
    if (dir === 'L') { x = cx - off; ch = '▶'; }
    else if (dir === 'R') { x = cx + off; ch = '◀'; }
    else if (dir === 'U') { y = cy - off; ch = '▼'; }
    else { y = cy + off; ch = '▲'; }
    ctx.save();
    ctx.globalAlpha = 0.25 + a * 0.7;
    ctx.fillStyle = p > 0.68 ? '#ff5566' : '#ffb05b';
    ctx.font = '800 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ch, x, y);
    ctx.restore();
  }

  burstColors(result) {
    if (result === 'PERFECT') return ['#fff', '#ffd35b', '#5bdcff', '#ffea9e'];
    if (result === 'GOOD') return ['#fff', '#5bdcff'];
    return ['#ff3b54', '#ff8a5b'];
  }

  clearTransients() {
    this.shockwaves.length = 0;
    this.popups.length = 0;
    this.deflect = null;
    this.flash = 0; this.shake = 0; this.vignette = 0;
  }
}
