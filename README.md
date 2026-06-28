# パリパリ（PariPari）⚔️

> 来た方向と**反対**を、ちょうどで弾け。
> iPhone SE のブラウザで快適に遊べる、ジャストタイミング受け流しゲーム。

敵の攻撃が来る方向が光ったら、攻撃が線に届く **ちょうどその瞬間** に、来た方向と
**反対**のボタンを1回タップして受け流す。早すぎ・遅すぎ・逆方向は失敗。3回ミスで終了。

判定は **PERFECT / GOOD / MISS** の3段階。連続成功（コンボ）で倍率が上がり、
中心に近いほどタイミングボーナスが入る。

## 遊び方

### A. 単一ファイル版（サーバー不要・いちばん手軽）
[`dist/paripari.html`](dist/paripari.html) は HTML/CSS/JS をすべて1ファイルに同梱した
自己完結版です。**このファイルを開く / iPhone に送って Safari で開くだけ**で遊べます。

```
npm run build   # src/ から dist/paripari.html を生成（再ビルドする場合）
```

### B. 開発（分割ソース）
`index.html` ＋ `src/`（ES Modules）構成。モジュールは `file://` だと読めないため、
ローカルの静的サーバー経由で開きます。

```
python3 -m http.server 8099
# → http://localhost:8099/index.html
```

スマホ実機では同じURLを Safari/Chrome で開く（縦持ち推奨）。

## ゲームプレイに必要なファイル
- **配布用（これ1つでプレイ可）**: `dist/paripari.html`
- **分割ソース（開発用）**: `index.html` ＋ `src/css/style.css` ＋ `src/js/*.js`
  （`docs/` `tests/` `build.mjs` はプレイには不要）

## 操作
- 左右の大きなボタン（高難度では上下も解禁）。
- PC: ←→（または A/D）、↑↓（W/S）でも操作可能。

## 設計ドキュメント
- 要件仕様書: [`docs/requirements.md`](docs/requirements.md)
- 実装計画書: [`docs/implementation-plan.md`](docs/implementation-plan.md)

## 技術構成
- 依存ゼロの Vanilla JS（ES Modules）+ Canvas 2D（ゲーム本体）+ DOM/CSS（HUD・メニュー）。
- **音は不採用**（BGM・効果音なし）。フィードバックは視覚中心＋触覚（振動）。
- `localStorage` にベストスコア/設定を保存。
- 時刻ベース判定（`performance.now()`）でフレームレート非依存。iPhone SE 最適化。

## テスト
判定・スコアの純粋ロジックは単体テスト済み。

```
npm test
```

## ディレクトリ
```
index.html
src/css/style.css
src/js/        # main, game, judge, scoring, enemy, input, renderer, particles, ui, storage, haptics, config
docs/          # requirements.md / implementation-plan.md
tests/         # judge / scoring の境界値テスト
```

## ライセンス
MIT
