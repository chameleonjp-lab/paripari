# パリパリ 共通仕様対応記録（2026-10-31）

## 対象と参照版

実験場が現在読むSupabase `games` の登録行で `is_active=true` とゲームURLを確認し、そのURLのHTTP200/タイトルを確認した。固定fallback一覧だけでは判定していない。今回対象 `paripari`。公開URL: https://chameleonjp-lab.github.io/paripari/

ランキング詳細: https://chameleonjp-lab.github.io/chameleonjp_lab/ranking.html?game=paripari

着手時GitHub公開ブランチ `claude/paripari-game-spec-2dc0tr`、SHA `bcc66037bfd7ac5bd33cc7983531169034ed1972`。進行中のopen PRは着手時およびPR作成前のAPI読取りで0件。ブランチ保護APIは403で詳細未確認、rulesetsの読取りは空。保護・環境・登録フラグは変更していない。Codebergからの導線切替は今回行わない（現在登録されたGitHub公開URLを維持）。

多言語基準: Sainome `79b1e5733e725cd1148b10fa5699ba846e2bf57d` / `src/i18n/index.js` SUPPORTED_LANGUAGES: ja,en,es,pt-BR,zh-Hans,fr,de,ko,ru,it,zh-Hant,id,tr,vi,th。

## 実装

ホームで任意名を入力し、開始時名/UUIDに結果を固定。匿名を公開せず、名前ありのみgeneric start→finish→idempotent submitを自動実行。結果を端末保存してリロード後も同一IDで再送、30名ランキングとX共有、生成効果音/オンオフ/音量を追加。単一HTMLビルドの欠けたplatform依存を修正し、継続的な検証/公開を追加。

## 対応表

| 共通仕様 | 状態 | 根拠・残り |
|---|---|---|
|1 対象判定|既存確認済み|現行登録行と公開HTMLを別々に確認。|
|2 既存仕様/記録|既存で維持|採点・時間・難易度・ゲームslug・保存済みデータを初期化しない。|
|3 正式URL/移行|既存URL維持|登録されたGitHub Pagesを正式URLとして使用。Codeberg側の新規公開/切替なし。別origin保存の移行完了は主張しない。|
|4 多言語|未完了|未完了: 日本語UI/結果/説明の15言語翻訳・言語選択。|
|5 名前/送信|今回実装/既存維持・一部未完了|今回任意名、開始名とstart/submission UUIDを固定、single-flightとサーバー冪等RPCを使用。追加キーparipari.pending-result:v1に元結果を保持。旧paripari.player-name/paripari.best/paripari.settingsを消さない。|
|6 ランキング|今回実装/既存維持・本人同一性未完了|今回サーバー自己ベスト集計30件へ。rank_noを表示し同名のクライアント集約なし。失敗/空/読み込み/再試行を区別。|
|7 X共有|今回実装|ホーム紹介と今回結果を分離。X投稿確定は利用者。黒/白、コピーまたは選択可能な代替。未翻訳言語は§4。|
|8 効果音|今回実装|下記イベント表。実際の聞こえ方は未確認。|
|9 音初期/保存|既存維持/今回実装|初回on、既存offと0尊重。実機復帰/音質は未確認。|
|10 文言/UI|今回実装・一部未確認|公開説明、共有/ランキングラベルと操作サイズ。iPhone17 Pro実機は未確認。|
|11 継続公開|今回実装・本番未確認|PRは検証のみ。保護を維持し、公開ブランチの検証済み成果物のみ公開。下記設定手順。|
|12 検証|今回実施・一部未完了|下記ログ要約。母語話者・実音・実機・マージ後公開は未実施。|
|13 PR/記録|今回作成|ゲーム別Draft PR。未完了を対象外に分類しない。|

## 記録とランキング契約

```json
[
  {
    "game_slug": "paripari",
    "title": "パリパリ",
    "game_url": "https://chameleonjp-lab.github.io/paripari/",
    "is_active": true,
    "release_date": "2026-08-31",
    "score_order": "desc",
    "score_scale": 1,
    "score_decimals": 0,
    "score_unit": "点",
    "top_ranking_type": "best",
    "submission_mode": "shared"
  }
]
```

サーバーの既存参加者は表示名で識別される。このままでは同名の別人を区別できず、改名で同じ参加者を保つことも保証できない。今回データを削除/再構築したり、全記録を新しい参加者へ割り当て直したりしない。別途、安定したparticipant IDと旧記録の所有確認/移行方式が必要。上位30名の厳密な「本人単位」の達成はこの制約が残る。API集計と詳細ランキングの既存名前単位集計は一致させる。表示名や上位一覧から圏外順位/全人数を推測しない。

## 効果音対応表

| 対象イベント/役割 | 条件・重複防止・箇所 |
|---|---|
|実在するゲームイベント|新規 src/js/sound.js。start（プレイ開始）、good/perfect（判定確定）、miss（失敗）、complete（練習完了）、result/best（通常結果/自己ベスト更新）。Game.onSound経由で実在イベントに接続。60ms間隔・最大3voice、終端音を優先し旧音停止。ノード解放、hidden時suspend、再開時に過去音を再生しない。初回on/volume0.35、保存off/0尊重。|
|無音時|視覚の判定・得点・状態表示を維持。音成功を開始条件にしない。|
|実音検証|自動テストは発音呼出/ノード/保存値を確認する範囲。スピーカーでの音量/音質・iPhone復帰は未確認。|

## 検証

ゲームunit22件、共有/ランキング/音声モジュール試験、bundle依存閉包、build/公開allowlist成功。Chromium/WebKitのモック通信ブラウザ検証で匿名/名変更/再表示/再読込冪等・同点30件・X・off/0保存を確認。

本番ランキングへ試験スコアを書いていない。ブラウザ検証はmock/ローカルページを使用し、幅変更・WebKitを実機Safari確認と混同しない。未実施の全言語自然さ、iPhone17 Pro Safariの縦横/ソフトキーボード/ブラウザバー/画面ロック復帰、実音、マージ後の公開確認は残る。

## 適用順・公開後確認・切戻し

GitHub Pages Source は `GitHub Actions`（workflow）をAPIで確認。

1. PR差分とCIを確認し、ユーザーが `claude/paripari-game-spec-2dc0tr` へマージする。直接push/自動マージはしない。
2. マージコミットの検証/ビルド/公開が成功したことと、公開URLの共有ラベル・ランキング詳細導線・今回の変更を確認する。PR段階の成功を本番公開済みとは扱わない。
3. iPhoneで名前空欄→開始→結果→ランキング、名前変更後の次プレイ、Xをキャンセルして復帰、音オフ/0→再読み込み、縦横とキーボード表示を短く確認する。実データへの多数の試験登録は避ける。
4. 問題があればこのPRをrevertする新PRを作成し通常の検証/マージで戻す。DB行/設定/自己ベストを消さない。Pages設定を変更した場合は元の `workflow` / `claude/paripari-game-spec-2dc0tr` 設定と既存公開artifactを記録して戻す。元の実行が新しい公開を後から上書きしないよう、古い実行を再実行しない。

現時点: **実装・ローカル検証済みの範囲と未完了を上記に区別 / ユーザーのマージ待ち / 必要な設定と権限は上記 / 本番公開後確認待ち**。共通仕様全体の完了報告ではない。
