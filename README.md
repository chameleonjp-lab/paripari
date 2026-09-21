# パリパリ（PariPari）⚔️

> **完成版の現在の計画**： [docs/plans/current/README.md](docs/plans/current/README.md)
>
> 2系統の試作を統合する [実装計画書 v2.0](docs/plans/current/IMPLEMENTATION_PLAN.md)、[受入検査](docs/plans/current/ACCEPTANCE_TESTS.md)、[進捗](docs/plans/current/PROGRESS.md) を追加しました。
> R1（本体と名前・共有の統合）はPR #6でマージ済みです。現在は **R2（入力時刻・共通時計・停止復帰）** の実装段階です。検査結果と残作業は[進捗](docs/plans/current/PROGRESS.md)を参照してください。完成版の公開とランキング連携は行っていません。
> 以下の説明と旧 `docs/requirements.md` / `docs/implementation-plan.md` は試作時点の内容です。完成版との相違は新しい計画を優先し、旧説明の「検査済み」等を今回の検査結果として扱わないでください。

## 現在の開発・検査手順

Node.js 24で次を実行します。ゲーム本体はブラウザ標準機能だけで動きます。開発用に、依存関係をたどって配布HTMLを作るesbuildと、自動操作用のPlaywrightを追加しています。

```sh
npm ci
npm test
npm run build
npm run build:check
npx playwright install --with-deps chromium webkit
npm run test:browser
```

`npm test` は元からある判定・得点・20段階の検査に、生成の失敗検出、名前・保存・共有、時計・配送順・停止状態の検査を加えます。`build:check` は分割ソースと配布物の一致を確認します。配布HTMLだけを直接修正しません。

ブラウザ検査は分割版と単一HTMLを実際に開きます。証拠の出力先は `PARIPARI_ARTIFACT_DIR` で指定できます。端末の通常の記録とは別のブラウザ環境を使い、検査用のゲーム操作口を本番には公開しません。PRのQuality検査は公開や外部得点送信を行いません。

R1では正式公開URLを空欄にしています。共有には現在の開発URLを使わず、公開URLが準備中であることを文面で案内します。URLの確定はR6で行います。入力時刻と停止復帰はR2、初回練習と画面品質の仕上げはR3、難易度と日本語説明はR4で続けます。

R2の時刻・入力順・停止の保証範囲と検査結果は[R2実装記録](docs/plans/current/R2_IMPLEMENTATION_REPORT.md)にまとめます。配送遅れ0〜50ミリ秒を保証するため、入力と期限切れを発生時刻順に確定します。250ミリ秒を超えて描画が途絶えた場合は一時停止し、復帰直後にまとめて失敗へ進めません。

以下は試作時点の説明です。特に「iPhoneでファイルを開くだけ」「描画頻度に依存しない」という記述は、今回の実機検査・時刻検査を保証するものではありません。

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
- 攻撃は上半分の**5方向**（左・右・上・左斜め上・右斜め上）から。下部の**5ボタン**で
  来た方向の**反対**を押して受け流す（左→右 / 右→左 / 上→下 / 左斜め上→右下 / 右斜め上→左下）。
- 開始時はノーダメージの**ウォームアップ**で5方向に慣らせる。
- **20ティアで段階的に難化**: 前半はバー速度＋速度ランダム性、後半は分割バー（1攻撃で
  最大3連タップ。同じ向きに連続タップ。1攻撃で失うHPは最大1）。
- PC: ←→/AD・↓/S・Q(or Z)=左下・E(or C)=右下。

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
