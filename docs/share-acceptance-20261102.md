# パリパリ：共有表示・紹介画像の検証記録

## 対象と変更範囲
- 対象：chameleonjp-lab/paripari。現在の既定・公開用 branch は `claude/paripari-game-spec-2dc0tr`、基点 `39a2aaa816b54f803248ba946443285fd3c07e47`。
- 古い `main` やその画像を現在の公開版と読み替えない。
- 共有文へ `#パリパリ #ゲーム制作` を追加。元のゲーム URL 末尾形式を維持。
- 横向きのホーム・結果画面では縦向き案内の全画面遮蔽を解除。プレイ・開始待ち・ポーズ画面の縦向き保護、ゲームルール、得点、識別値、ランキング、音は変更しない。
- 元から独立したコピー専用ボタンはない。X が開けないときのコピー・テキスト選択 fallback は維持。

## 検証の区別
- ローカル：既存ゲーム・ランキング等の検査、新しい 15 言語の実共有関数、ネットワーク遮断境界、最終 63 Node tests、build、standalone bundle 検査を実施。
- ブラウザ：CI の隔離 mock のみ。外部通信は拒否し、ランキング読み取りだけを明示 mock。実際の匿名ゲーム開始と自然な HP 0 終了で結果画面を検査する。
- ローカル静的サーバーへの GET/HEAD だけを通し、外部・POST・リダイレクト・WebSocket は拒否、Service Worker は無効化。
- 素材取得は通常受入とは別 context。実 Canvas と自然に接近する攻撃を読むだけで、強制生成、時計、ゲーム状態、描画関数は変更しない。
- 実 iPhone、実 X 投稿・カード取得、本番配信の受入は別。CI 成功のみではこれらを成功としない。

## 保存する失敗履歴
1. 初期 CI 41430966608：新タグの追加位置が既存 URL 末尾条件と衝突。タグを URL 直前へ移し、既存 assert は弱めず修正。
2. CI 41431703085：ホーム横向きの X が全画面縦向き案内に遮られることを PNG と hit 判定で確認。ホーム・結果の visible sibling だけを対象に CSS 修正。
3. CI 41432298896：上記の 3 サイズ表示は通過したが、連続 tap の intent 待ちが timeout。既存 300 ms double-tap 防止との干渉候補。製品の入力保護は変更せず、実 touchend を観測してその境界を過ぎた通常 tap を検査する。旧実行の実間隔未取得のため原因を断定しない。

## 実ブラウザ・画像の根拠
- 素材取得と先行受入の固定 commit：`ed2f577d1051334a40bccc202e935806587c05d9`。
- CI run `41434081483` / verify job `125239498618`：Chromium / WebKit の旧回帰と新 15 言語共有受入が成功。匿名の自然終了はそれぞれ約 6.150 秒 / 6.251 秒、3 回 MISS、HP 0、score 0。実ランキングへの試験送信はない。
- 代表 ja/en/de の縦・横・短高で X 対象へのスクロール到達、44 px 以上、遮蔽なし、黒白・押下色、intent 内容を確認。画面全体の常時表示や全説明文の無切れを保証するものではない。
- artifact `13135144071` の `webkit-actual-attack-canvas.png` は 600×900、72,558 bytes、SHA-256 `4abfa8e013cd573cf2a5bf76d235bbcc8ebaf85159e6927ed11875b7cdf49a89`。実 Canvas2D に自然に現れた右からの攻撃・青い中心・白いリングを双方エンジンの画像で確認した。
- `docs/share-assets/paripari-og-v1.svg` はこの PNG を埋め込み、中央盤面を等比配置した紹介画像。ゲーム要素の描き足しはない。既存 Inkscape による native SVG→PNG 構成で、外部画像参照や追加課金はない。
- 完成 `assets/paripari-og-v1.png` は 1200×630、413,586 bytes、SHA-256 `688969390693ade95047bb3778ad4eee9d531e6d8d094a33eaf1ade8d63fb92c`。タイトル・説明・実盤面の整合、文字切れなし、名前・成績なしを独立に実見した。
- 素材取得の helper は保全するが `PARIPARI_CAPTURE_SHARE_MATERIAL=1` の明示時のみ。最終 workflow はこの設定を外し、通常共有受入へ毎回の素材撮影負荷を重ねない。
- Pages の staging には runtime の `index.html` / `src` / `assets` のみ。検証用 SVG・資料・テスト画像は配備しない。旧本番 branch 条件と production concurrency は維持する。

## 適用・復元・残る確認
- コード正本はこの GitHub 差分。公開用 branch への直接反映・本番配備・マージは行わない。本人の Draft PR 確認・マージ後に既存公開工程が動く。
- 本資料の先行 CI 成功を、画像設定後の最終 CI 成功へ読み替えない。最終固定 head の CI / 読み戻し結果は PR 本文へ追記する。
- 元へ戻す場合は本 PR の差分を revert する。元の source / CSS / standalone package は基点 commit に保持し、古い別 branch の画像へ置き換えない。
- 本人マージ、公開後の OG 画像応答・metadata、X カードキャッシュ、実 iPhone の表示と tap は未確認。新しい画像設定だけで自動公開・実投稿成功とはしない。
