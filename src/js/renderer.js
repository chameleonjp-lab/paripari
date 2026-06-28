// Canvas 2D 描画 要件 §4.4 §6.4
import { CONFIG } from './config.js';
import { attackProgress } from './enemy.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 0; this.h = 0; this.dpr = 1;
    this.lineY = 0;       // パリィライン（プレイヤー）Y
    this.flash = 0;       // 0..1 閃光
    this.flashColor = '#fff';
    this.shake = 0;       // px
    this.t = 0;           // 累積時間（背景アニメ用）
    this.resize();
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, CONFIG.DPR_CAP);
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.lineY = this.h * 0.58;
  }

  triggerFlash(color, intensity = 1) {
    this.flash = Math.max(this.flash, intensity);
    this.flashColor = color;
  }
  triggerShake(px) { this.shake = Math.max(this.shake, px); }

  // 攻撃の出現座標（方向→画面端）
  attackStart(dir) {
    switch (dir) {
      case 'L': return { x: -40, y: this.lineY };
      case 'R': return { x: this.w + 40, y: this.lineY };
      case 'U': return { x: this.w / 2, y: -40 };
      case 'D': return { x: this.w / 2, y: this.h + 40 };
      default: return { x: this.w / 2, y: -40 };
    }
  }

  draw(dt, state, particles) {
    const ctx = this.ctx;
    this.t += dt;
    // decay
    this.flash = Math.max(0, this.flash - dt * 4.5);
    this.shake = Math.max(0, this.shake - dt * 60);

    ctx.save();
    // シェイク
    if (this.shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    this._drawBackground(ctx);
    this._drawParryLine(ctx, state);
    this._drawPlayer(ctx, state);

    // 攻撃
    if (state.attack && !state.attack.resolved) {
      this._drawAttack(ctx, state.attack, state.now);
    } else if (state.attack && state.attack.resolved && state.now - state.attack.resolvedAt < 180) {
      // 受け流し後の余韻（弾かれた軌跡）
      this._drawResolved(ctx, state.attack, state.now);
    }

    particles.draw(ctx);
    ctx.restore();

    // 閃光（全面）
    if (this.flash > 0.01) {
      ctx.save();
      ctx.globalAlpha = Math.min(0.85, this.flash);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.restore();
    }
  }

  _drawBackground(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, '#0a0a16');
    g.addColorStop(0.6, '#0f1226');
    g.addColorStop(1, '#07070d');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // ほのかな放射状の墨だまり
    const cx = this.w / 2, cy = this.lineY;
    const rg = ctx.createRadialGradient(cx, cy, 10, cx, cy, this.w * 0.7);
    rg.addColorStop(0, 'rgba(40,60,120,0.18)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, this.w, this.h);
  }

  _drawParryLine(ctx, state) {
    const y = this.lineY;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(this.w, y);
    ctx.stroke();
    ctx.restore();
  }

  _drawPlayer(ctx, state) {
    const cx = this.w / 2;
    const cy = this.lineY;
    const pulse = 1 + Math.sin(this.t * 3) * 0.04;
    const r = 26 * pulse;
    ctx.save();
    // 守りの輪
    ctx.strokeStyle = 'rgba(91,220,255,0.7)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(91,220,255,0.7)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // 中心
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(233,238,247,0.92)';
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawAttack(ctx, attack, now) {
    const p = attackProgress(attack, now);
    const start = this.attackStart(attack.dir);
    const cx = this.w / 2, cy = this.lineY;
    // ease-in 接近
    const e = p * p;
    const x = start.x + (cx - start.x) * e;
    const y = start.y + (cy - start.y) * e;

    // 予兆: 攻撃側エッジの発光（早期ほど強く）
    const telGlow = Math.max(0, 1 - p) * 0.5 + 0.2;
    this._drawEdgeGlow(ctx, attack.dir, telGlow);

    // 斬撃本体
    const angle = Math.atan2(cy - start.y, cx - start.x);
    const len = 60 + 40 * e;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    const danger = p > 0.7;
    const col = danger ? '#ff3b54' : '#ff8a5b';
    ctx.strokeStyle = col;
    ctx.lineWidth = 5 + 6 * e;
    ctx.lineCap = 'round';
    ctx.shadowColor = col;
    ctx.shadowBlur = 18;
    ctx.globalAlpha = Math.min(1, 0.4 + p);
    ctx.beginPath();
    ctx.moveTo(-len / 2, 0);
    ctx.lineTo(len / 2, 0);
    ctx.stroke();
    ctx.restore();

    // 方向アイコン（攻撃の来る方向）
    this._drawDirArrow(ctx, attack.dir, telGlow);
  }

  _drawResolved(ctx, attack, now) {
    const k = Math.max(0, Math.min(1, (now - attack.resolvedAt) / 180));
    const cx = this.w / 2, cy = this.lineY;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - k);
    ctx.strokeStyle = attack.result === 'MISS' ? '#ff3b54' : '#ffd35b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 30 + k * 60, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  _drawEdgeGlow(ctx, dir, a) {
    ctx.save();
    ctx.globalAlpha = a;
    let grad;
    const c = 'rgba(255,80,90,';
    if (dir === 'L') {
      grad = ctx.createLinearGradient(0, 0, this.w * 0.3, 0);
      grad.addColorStop(0, c + '0.55)'); grad.addColorStop(1, c + '0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, this.w * 0.3, this.h);
    } else if (dir === 'R') {
      grad = ctx.createLinearGradient(this.w, 0, this.w * 0.7, 0);
      grad.addColorStop(0, c + '0.55)'); grad.addColorStop(1, c + '0)');
      ctx.fillStyle = grad; ctx.fillRect(this.w * 0.7, 0, this.w * 0.3, this.h);
    } else if (dir === 'U') {
      grad = ctx.createLinearGradient(0, 0, 0, this.h * 0.3);
      grad.addColorStop(0, c + '0.55)'); grad.addColorStop(1, c + '0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, this.w, this.h * 0.3);
    } else {
      grad = ctx.createLinearGradient(0, this.h, 0, this.h * 0.7);
      grad.addColorStop(0, c + '0.55)'); grad.addColorStop(1, c + '0)');
      ctx.fillStyle = grad; ctx.fillRect(0, this.h * 0.7, this.w, this.h * 0.3);
    }
    ctx.restore();
  }

  _drawDirArrow(ctx, dir, a) {
    const cx = this.w / 2, cy = this.lineY;
    const off = 70;
    let x = cx, y = cy, ch = '◀';
    if (dir === 'L') { x = cx - off; ch = '▶'; }      // 左から来る→右へ受け流す方向の矢印
    else if (dir === 'R') { x = cx + off; ch = '◀'; }
    else if (dir === 'U') { y = cy - off; ch = '▼'; }
    else { y = cy + off; ch = '▲'; }
    ctx.save();
    ctx.globalAlpha = 0.3 + a;
    ctx.fillStyle = '#ffd35b';
    ctx.font = '700 20px sans-serif';
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
}
