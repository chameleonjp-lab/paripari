# パリパリ（PariPari）⚔️

> 来た方向と**反対**を、ちょうどで弾け。
> iPhone SE のブラウザで快適に遊べる、ジャストタイミング受け流しゲーム。

敵の攻撃が来る方向が光ったら、攻撃が線に届く **ちょうどその瞬間** に、来た方向と
**反対**のボタンを1回タップして受け流す。早すぎ・遅すぎ・逆方向は失敗。3回ミスで終了。

判定は **PERFECT / GOOD / MISS** の3段階。連続成功（コンボ）で倍率が上がり、
中心に近いほどタイミングボーナスが入る。

## 遊び方
ブラウザで `index.html` を開くだけ。ビルド不要・依存ゼロ。

```
# ローカル確認（任意の静的サーバで可）
python3 -m http.server 8099
# → http://localhost:8099/index.html
```

スマホ実機では同じURLを Safari/Chrome で開く（縦持ち推奨）。

## 操作
- 左右の大きなボタン（高難度では上下も解禁）。
- PC: ←→（または A/D）、↑↓（W/S）でも操作可能。

## 設計ドキュメント
- 要件仕様書: [`docs/requirements.md`](docs/requirements.md)
- 実装計画書: [`docs/implementation-plan.md`](docs/implementation-plan.md)

## 技術構成
- 依存ゼロの Vanilla JS（ES Modules）+ Canvas 2D（ゲーム本体）+ DOM/CSS（HUD・メニュー）。
- Web Audio API で効果音を合成（アセット不要）。`localStorage` にベストスコア/設定を保存。
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
src/js/        # main, game, judge, scoring, enemy, input, renderer, particles, audio, ui, storage, haptics, config
docs/          # requirements.md / implementation-plan.md
tests/         # judge / scoring の境界値テスト
```

## ライセンス
MIT
