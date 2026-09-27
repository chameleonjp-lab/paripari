# パリパリ Supabaseランキング連携

- 更新日: 2026年9月28日
- 対象ゲーム: `paripari`
- 接続先: カメレオンJP実験場の `public.games` / `get_best_score_ranking`
- 表示件数: TOP10
- 公開状態: コードはランキング連携Draft PR、ゲーム行は `is_active=false`

## 呼び出し順

1. 本番プレイが `START` になった時点で `start_game_play_v1` を呼ぶ。練習プレイは集計しない。
2. ゲームオーバー時に `finish_game_play_v1` を呼ぶ。
3. 結果が確定したスコアだけ `submit_score_idempotent_v1` へ送る。`submission_id` は再送しても二重登録にならない。
4. 結果画面で `get_best_score_ranking('paripari', 10)` を呼び、TOP10を表示する。

通信失敗時は結果画面を止めず、プレイID・送信ID・結果を `localStorage` に保存する。次回起動時に開始・終了・スコア送信を順番に再試行する。

## 公開前ゲート

Supabaseの `paripari` 行は、Pagesへランキング対応コードが反映されるまで `is_active=false` にしている。Draft PRのCIとマージ後のPages反映を確認してから、管理者が `is_active=true` に変更する。
