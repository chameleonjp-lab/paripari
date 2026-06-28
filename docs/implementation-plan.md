# パリパリ 実装計画書 v1.0

要件仕様書 `docs/requirements.md` の確定要件に基づく実装計画。
ビルドレス（依存ゼロ）の Vanilla JS + Canvas2D + DOM HUD 構成で、iPhone SE 最適化を前提とする。

---

## 1. アーキテクチャ方針

- **状態機械（State Machine）**: `TITLE / TUTORIAL / READY / PLAYING / PAUSE / RESULT`。
- **時刻ベース判定**: すべての進行・判定を `performance.now()` の経過時刻で計算しfps非依存に。
- **関心の分離**:
  - 純粋ロジック（`judge.js` / `scoring.js` / `config.js`）= 副作用なし・テスト対象。
  - 描画（`renderer.js` / `particles.js`）= Canvas 出力のみ。
  - 入出力（`input.js` / `haptics.js` / `storage.js` / `ui.js`）= 環境I/O。
  - 統合（`game.js` / `main.js`）= ループとオーケストレーション。
- **データ駆動**: 難易度ティア・窓・スコアは `config.js` の定数で一元管理。

---

## 2. モジュール詳細と責務

| モジュール | 公開API（概略） | 責務 |
| --- | --- | --- |
| `config.js` | `CONFIG` 定数 | 判定窓/スコア/ティア/演出パラメータ |
| `judge.js` | `judgeTiming(deltaMs, dirOk, cfg)` → `'PERFECT'|'GOOD'|'MISS'` | 3段階判定（純粋） |
| `scoring.js` | `calcGain(judge, combo, deltaMs, cfg)`, `comboMultiplier(combo)` | 加点計算（純粋） |
| `enemy.js` | `Attack` 生成: 方向・予兆時刻・インパクト時刻T・状態 | 攻撃ライフサイクル |
| `input.js` | `onAction(cb)`: `{dir, time}` を発火 | pointer/touch/keyの正規化 |
| `particles.js` | `ParticlePool.spawn(...)`, `update(dt)`, `draw(ctx)` | 火花/閃光プール |
| `renderer.js` | `draw(state)` | 背景/侍/攻撃/HUDオーバーレイ演出 |
| `haptics.js` | `vibrate(pattern)` | navigator.vibrate ラッパ（設定連動） |
| `storage.js` | `getBest()`, `setBest(n)`, `getSettings()`, `setSettings()` | localStorage |
| `ui.js` | `showScreen()`, `updateHUD()`, `showResult()`, `popJudge()` | DOM HUD/メニュー |
| `game.js` | `Game` クラス: `start/update/handleAction/pause` | 状態機械・進行制御 |
| `main.js` | 起動・rAFループ・配線 | エントリポイント |

---

## 3. 主要ロジック擬似コード

### 3.1 判定（judge.js）
```
function judgeTiming(deltaMs, dirOk, cfg):
  if not dirOk: return 'MISS'
  a = abs(deltaMs)
  if a <= cfg.PERFECT_WINDOW: return 'PERFECT'
  if a <= cfg.GOOD_WINDOW:    return 'GOOD'
  return 'MISS'
```

### 3.2 攻撃の時間モデル（enemy.js / game.js）
```
spawnAttack(now, tier):
  dir = randomDir(tier.directions)        # 攻撃の来る方向
  telegraphAt = now                        # 予兆開始
  impactAt   = now + tier.visibleMs        # T（パリィライン到達）
  windowEnd  = impactAt + cfg.GOOD_WINDOW   # 無入力MISS確定
  state = 'TELEGRAPH'
```
- 各フレーム: `now >= windowEnd` かつ未判定 → 強制 MISS。
- 入力時: 予兆中(now>=telegraphAt) の最初の1回のみ受理。
  - `delta = inputTime - impactAt`
  - `dirOk = (inputDir == opposite(dir))`  # 反対側を押す
  - `result = judgeTiming(delta, dirOk, cfg)`

### 3.3 進行・ティア昇格（game.js）
```
on success: combo++; score += calcGain(...); successCount++
on miss:    combo = 0; hp--; if hp==0 -> RESULT
tier = tierFor(successCount)   # config のしきい値から決定
nextSpawnDelay = tier.intervalMs ± jitter
```

### 3.4 スコア（scoring.js）
```
comboMultiplier(combo) = min(1 + floor(combo/5)*0.5, 4.0)
timingBonus(delta)     = round((1 - abs(delta)/GOOD_WINDOW) * 50) clamped [0,50]
calcGain(judge, combo, delta):
  base = judge=='PERFECT' ? 300 : judge=='GOOD' ? 100 : 0
  if base==0: return 0
  return round(base * comboMultiplier(combo) + timingBonus(delta))
```

---

## 4. 描画・演出設計（renderer / particles）

- レイヤ: 背景グラデ → パリィライン → 侍 → 攻撃（接近補間）→ パーティクル → フラッシュ。
- 攻撃の接近: `progress = (now - telegraphAt)/(impactAt - telegraphAt)` を ease-in で線へ補間。
- PERFECT: 0.08〜0.12秒のヒットストップ＋スローモー（dtスケール）、金閃光、火花大。
- GOOD: 白閃光・火花中。MISS: 朱フラッシュ＋画面シェイク（弱, モーション低減でOFF）。
- パーティクルはプール（固定数, 再利用）。フレーム内allocゼロを目標。

---

## 5. iPhone SE / iOS Safari 対応チェックリスト

- [ ] viewport meta（maximum-scale=1, user-scalable=no, viewport-fit=cover）。
- [ ] `touch-action:none` / `overscroll-behavior:none` / body 固定でバウンス抑止。
- [ ] `pointerdown` 主・`touchstart` フォールバック・`click` 不使用。
- [ ] ダブルタップズーム抑止（preventDefault）。
- [ ] Canvas DPR 対応（上限3）。`100dvh`/`visualViewport` で高さ実測。
- [ ] `env(safe-area-inset-*)` 反映。320px幅で破綻しないレイアウト。
- [ ] 回転（横）時ポーズ＋縦持ち誘導。タブ復帰時ポーズ。

---

## 6. 実装ステップ（順序）

1. **足場**: `index.html`（meta/レイアウト骨格）+ `style.css`（縦3分割・ボタン）+ 空ループ。
2. **純粋ロジック**: `config.js` / `judge.js` / `scoring.js` ＋ `tests/`。
3. **入力**: `input.js`（pointer/touch/key、時刻記録、ズーム/スクロール抑止）。
4. **コアループ**: `game.js` 状態機械 + `enemy.js` 攻撃生成・時刻判定。
5. **描画**: `renderer.js`（侍/攻撃/パリィライン）+ `particles.js`。
6. **HUD/メニュー**: `ui.js`（HP/スコア/コンボ/判定ポップ/各画面）。
7. **演出**: 収束タイミングリング/方向フリック/衝撃波/スコアポップ/コンボオーラ/
   閃光/ヒットストップ/スローモー/シェイク/背景アンビエント、`haptics.js`。
8. **永続化/設定**: `storage.js`（ベスト・設定）、設定UI。
9. **チュートリアル/オンボーディング**。
10. **難易度ティア**結線＋バランス調整。
11. **iOS対応総点検**（§5）＋受け入れ基準（要件§8）確認。
12. ドキュメント更新・コミット・PR。

---

## 7. テスト計画

- `tests/`: `judge` と `scoring` の境界値テスト（軽量・ブラウザ or node 実行可能な形）。
- 手動: 要件 §9 の端末/ブラウザ・回転・復帰・パフォーマンス確認。
- 受け入れ: 要件 §8 の12項目をチェックリスト化して確認。

---

## 8. リスクと対策

| リスク | 対策 |
| --- | --- |
| iOSの入力遅延で判定が理不尽 | 窓を余裕設定（±60/±140ms）、必要ならキャリブレーション |
| Safariのvibrate非対応 | 触覚は加点要素・視覚/聴覚で成立、設定でOFF |
| 100vh/アドレスバーで高さズレ | `dvh`/`visualViewport`実測、リサイズ再計算 |
| パーティクルでFPS低下 | プール化・上限・モーション低減設定 |
| 縦3分割が320px幅で窮屈 | clamp/vwで可変、最小領域を死守、HUD簡素化 |
