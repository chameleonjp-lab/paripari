// パーティクルプール（GCスパイク回避） 要件 §6.6
const MAX = 220;

export class ParticlePool {
  constructor() {
    this.pool = new Array(MAX).fill(null).map(() => ({
      active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1,
      size: 2, color: '#fff', gravity: 0,
    }));
  }

  spawnBurst(x, y, opts = {}) {
    const {
      count = 16, speed = 320, spread = Math.PI * 2, angle = 0,
      colors = ['#fff'], size = 3, life = 0.5, gravity = 600,
    } = opts;
    let spawned = 0;
    for (let i = 0; i < this.pool.length && spawned < count; i++) {
      const p = this.pool[i];
      if (p.active) continue;
      const a = angle + (Math.random() - 0.5) * spread;
      const sp = speed * (0.4 + Math.random() * 0.6);
      p.active = true;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * sp;
      p.vy = Math.sin(a) * sp;
      p.maxLife = life * (0.6 + Math.random() * 0.6);
      p.life = p.maxLife;
      p.size = size * (0.6 + Math.random() * 0.8);
      p.color = colors[(Math.random() * colors.length) | 0];
      p.gravity = gravity;
      spawned++;
    }
  }

  update(dt) {
    for (const p of this.pool) {
      if (!p.active) continue;
      p.life -= dt;
      if (p.life <= 0) { p.active = false; continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.pool) {
      if (!p.active) continue;
      const t = p.life / p.maxLife;
      ctx.globalAlpha = Math.max(0, t);
      ctx.fillStyle = p.color;
      const s = p.size * (0.4 + t * 0.6);
      ctx.beginPath();
      ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  clear() {
    for (const p of this.pool) p.active = false;
  }
}
