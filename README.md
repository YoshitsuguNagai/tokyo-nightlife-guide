# Tokyo Nightlife Guide — Phase 1（改善版 v2）

外国人向けキャバクラ検索・送客ポータル（日本語 / English / 中文 の3言語対応）
Node.js + Express + SQLite のシンプル構成で、Render へそのままデプロイできます。

---

## 1. 起動方法（ローカル）

```bash
npm install
node server.js
```

- サイト: http://localhost:3000/
- 管理画面: http://localhost:3000/admin.html
- 管理者ログイン: `admin@tng.jp` / `admin123` ← **公開前に必ず変更してください**
- デモユーザー: `user@tng.jp` / `user123`

## 2. Render へのデプロイ（GitHub 連携）

1. このフォルダを GitHub リポジトリに push
2. Render → 「New」→「Web Service」→ 対象リポジトリを選択
3. Build Command: `npm install`
4. Start Command: `node server.js`
5. （重要）下記「3. 画像の永続保存」を設定

※ SQLite のデータファイル `data.sqlite` は Render の再デプロイで初期化されます。
　本番運用では Render の「Disk」追加、または PostgreSQL への移行をご検討ください。

---

## 3. 画像の永続保存（Cloudinary）★重要

Render は再デプロイのたびにローカルファイルが消えます。
画像を消えないようにするため、無料の外部画像ストレージ **Cloudinary** を使います。
（管理画面のアップロード機能が自動で Cloudinary に保存します。未設定の場合はローカル保存=再デプロイで消えます）

### ① Cloudinary に登録（無料）
1. https://cloudinary.com/ にアクセス →「Sign Up For Free」
2. メールアドレス等を入力してアカウント作成

### ② Cloud 名（Cloud Name）を確認
1. ログイン後のダッシュボード（https://console.cloudinary.com/ ）上部に表示される
   **「Cloud Name」**（例: `dxyz123ab`）をメモ

### ③ アップロード・プリセットを作成
1. 右上の歯車アイコン（Settings）→ 左メニュー「Upload」
2. 「Upload presets」欄の「Add upload preset」
3. **Signing Mode を「Unsigned」に変更**（これが必須です）
4. 「Preset name」をメモ（例: `tng_upload`）→「Save」

### ④ Render に環境変数を登録
1. Render ダッシュボード → 対象の Web Service → 左メニュー「Environment」
2. 「Add Environment Variable」で以下の2つを登録：

| Key | Value（例） |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | ②でメモした Cloud Name（例: `dxyz123ab`） |
| `CLOUDINARY_UPLOAD_PRESET` | ③でメモしたプリセット名（例: `tng_upload`） |

3. 「Save Changes」で自動再デプロイ → 完了

※ 費用: Cloudinary 無料プラン（25クレジット/月）で小規模運用は十分カバーできます。

---

## 4. Google マップについて（APIキー不要）

店舗ページの地図は **Google Maps の共有リンクを使った埋め込み方式**のため、
**APIキーの取得・課金設定は一切不要**です。

- 管理画面「店舗 → Googleマップ URL」に、Googleマップの「共有 → リンクをコピー」で
  取得した URL を貼るだけで地図が店舗ページに表示されます。
- 未入力でも「住所」から自動で地図を表示します。

---

## 5. 自動翻訳について

管理画面の多言語項目（店舗名・紹介文・イベント・クーポン・ブログ等）には
**「日本語 → 英語・中文 に自動翻訳」ボタン**があります。

- 現在はサーバー内蔵の簡易辞書翻訳（`server.js` の `naiveTranslate`）です。
  未登録の文章は `[EN] 原文` の形式で出力されます。
- **本番運用では翻訳APIへの差し替えを推奨**します。差し替えは `server.js` の
  `POST /api/translate` 1か所だけでOKです（DeepL API / Google Cloud Translation 等）。
- 自動翻訳の結果は管理画面でいつでも手動修正できます。
  DB は従来通り `xxx_ja / xxx_en / xxx_zh` の3カラム構造です。

---

## 6. 主な機能（Phase 1）

- 店舗検索（エリア / ジャンル[キャバクラ・ラウンジ・クラブ] / 予算3段階 / 英語・中国語対応 / 外国人歓迎 / カード可 / 口コミ人気順）
- 店舗詳細（About / キャスト / 口コミ / イベント / クーポン / アクセスのタブ + 画面下部の固定CTA）
- キャスト詳細、イベント詳細ページ
- 口コミ（投稿 → 管理画面で承認後に公開。未承認件数をダッシュボードに通知表示）
- クーポン取得、お気に入り、簡易DM（3言語翻訳フィールド付き）
- ブログ（SEOタイトル/説明文/slug 管理）
- 管理画面：全データの追加・編集・削除・検索・公開切替
  - ステータスはプルダウン選択（手入力なし）
  - 支払い方法はチェックボックス（複数選択）
  - 画像はファイルアップロード＋プレビュー
  - エリア・店舗はドロップダウン選択

## 7. ディレクトリ構成

```
server.js          API サーバー（認証 / 公開API / 管理CRUD / 画像アップロード）
db.js              SQLite スキーマ（12テーブル）+ シードデータ + マイグレーション
public/index.html  利用者側 SPA（モバイルファースト / 3言語 / 黒×ゴールド）
public/admin.html  管理画面 SPA
public/uploads/    ローカル画像保存先（Cloudinary 未設定時のみ使用）
```

## 8. セキュリティ上の注意（公開前チェック）

- [ ] 管理者パスワード `admin123` を変更する
- [ ] デモユーザー `user@tng.jp` を削除する
- [ ] Cloudinary を設定する（画像消失防止）
- [ ] Render の Persistent Disk または外部DBを検討する（データ消失防止）

## 9. Phase 2 以降の拡張ポイント

- 翻訳API（DeepL等）への差し替え → `POST /api/translate`
- LINE Messaging API 連携 → `stores.line_url` から拡張
- 予約・決済・店舗課金 → テーブル追加で拡張可能
