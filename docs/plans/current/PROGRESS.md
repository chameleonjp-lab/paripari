# パリパリ完成版 進捗

更新日：2026-09-27（日本時間）／計画版：2.0
関連：[実装計画書](IMPLEMENTATION_PLAN.md)／[受入検査](ACCEPTANCE_TESTS.md)／[R1実装記録](R1_IMPLEMENTATION_REPORT.md)／[R2実装記録](R2_IMPLEMENTATION_REPORT.md)／[R3実装記録](R3_IMPLEMENTATION_REPORT.md)／[R4実装記録](R4_IMPLEMENTATION_REPORT.md)／[R5実装記録](R5_IMPLEMENTATION_REPORT.md)／[R6公開準備記録](R6_RELEASE_READINESS.md)

## 現在の状態

ユーザーからPR #5に従う実装開始と、PR #5以降のマージ完了・後続対応開始の指示を受けました。R6の提出基準として、R5のPR #11マージ後のmain `09a450dfa31f3303fb50d58c6aebb872eda3faa8` を確認しました。Draft PRのブランチはこのmainから作成します。

R1のPR #6はマージ済みです。最終コミットのQualityで単体41件とChromium/WebKit計26件が合格しました。マージコミット `6c05e11ea4d32143665c2bdca2cc89b07cbc1b35` を基準として、R2の入力時刻・共通時計・停止復帰を実装しました。ローカル単体69件、Chromium 15件、生成一致、独立コードレビューが合格しています。最終コミットのQuality結果はR2のPR本文とActionsログを参照してください。ゲーム全体の完成や公開を意味しません。ランキング連携は対象外です。

R2のPR #7と、そのマージ後に失敗したブラウザ検査を修正するPR #8がマージ済みです。main `b4638af35a15de5274ca1f3127f87aa036c10977` の[Quality #13](https://github.com/chameleonjp-lab/paripari/actions/runs/36254368785)成功を確認してR3を実施しました。R3はPR #9として提出・マージされ、マージ後のmainのQuality `36256055770` も成功しています。[R3実装記録](R3_IMPLEMENTATION_REPORT.md)に初回練習・本番集計の分離・再挑戦・保存・画面の変更をまとめています。

| 工程 | 状態 | 次に満たすこと |
| --- | --- | --- |
| R0 計画を作成 | PR #5採用・マージ済み | 最新指示を優先して実装する |
| R1 基準を統合 | [PR #6](https://github.com/chameleonjp-lab/paripari/pull/6)マージ済み、実装・独立レビュー・Quality合格 | R2へ引き継ぐ |
| R2 入力と時間 | PR #7/#8マージ済み、mainのQuality成功 | R3以後も回帰検査を維持する |
| R3 一巡する画面 | PR #9マージ済み、マージ後Quality成功 | R4へ引き継ぐ |
| R4 難易度と説明 | PR #10マージ済み、Quality成功 | R5へ引き継ぐ |
| R5 公開候補の検証 | [PR #11](https://github.com/chameleonjp-lab/paripari/pull/11)マージ済み、Quality #21でChromium/WebKit/verify成功、独立レビュー承認 | R6へ引き継ぐ |
| R6 公開準備 | [PR #12](https://github.com/chameleonjp-lab/paripari/pull/12) Draft、Quality #24でChromium/WebKit/verify成功、独立レビュー承認 | 実機確認・正式URL・公開予定パス・プレビューを確認する。実公開は別の指示後 |

## 次の工程

R2では入力時刻の欠落、±140ミリ秒の境界、描画間隔の切り捨て、演出による速度差、カウントダウン中の離脱を修正しました。配送0〜50ミリ秒の保証と250ミリ秒を超える途絶での停止を採用しています。判断の根拠、検査範囲、実機未確認事項はR2実装記録にまとめています。

R3は成功した方向だけ進む初回練習、本番集計の完全分離、練習完了の案内、必要画面の文字拡大・短画面対応を含みます。R4では20段階の成功数境界、2連・3連の登場時期と確率、速度値、必要回数・残り回数の表示を固定しました。固定乱数1,000系列では2連中央値47.29秒、3連中央値74.74秒でした。R5では長時間相当の進行、100回再挑戦、外部通信、両形式の回帰を確認しました。R6では正式URL・公開元・ライセンス・実機確認・プレビュー画像の状態を、公開操作なしで整理します。

## 確認の区別

単体検査、ブラウザ検査、独立レビュー、GitHub Actions、実機確認を分けて各実装記録とPRに残します。R5の単体91件、配布物一致、Chromium/WebKit/verify、独立レビューは完了しています。ローカルのブラウザ本体は環境制限で導入できなかったため、ブラウザ合否はGitHub Actionsで確認しました。受入検査53件を全て合格にしたわけではありません。iPhone 17 Pro Safari実機確認、正式URL、公開予定パス、プレビュー画像は未確認で、公開候補の承認は行っていません。

mainへの直接書き込み、マージ、自動マージ、保護設定・既定ブランチ・公開設定の変更はしません。正式公開URLは推測で設定せず、公開前に確認します。
