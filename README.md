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


---

## 10. v3 追記（2026-09-07）

### 新機能
- **センターモードカルーセル**: 店舗詳細・キャスト詳細の写真を中央大+両サイド小のスライダー表示。PCは矢印/クリック、スマホはスワイプ対応。管理画面の「追加写真」に複数登録すると自動で有効化
- **キャスト絞り込み検索**: 「キャストを探す」ページに店舗エリア・身長・バスト・系統・顔立ち（常時表示）+ 出身地・お酒・接待スキル・スタイル・髪型（「さらに条件を追加」で展開）
- **キャスト口コミ**: 店舗口コミとは別にキャスト個人へ紐づけて投稿・表示。管理画面の口コミ一覧は「店舗/キャスト」バッジで区別。承認制は従来通り
- **Other Cast**: キャスト詳細下部に同店舗の他キャストを表示

### 不具合修正
- Chromeで言語切替が効かない問題 → `translate="no"` でChrome自動翻訳を無効化し、言語状態を localStorage で一元管理
- フッターのLINE表記 → 全言語で「LINE」固定（翻訳対象外に指定。Instagram/Google Mapsも同様）
- 「口コミ」タブが押せない問題 → タブの flex レイアウトを修正
- 「Googleマップで開く」→ `https://www.google.com/maps/search/?api=1&query=...` 形式で外部遷移（埋め込みURLとの混用を解消）
- 管理画面「翻訳」ボタン → 口コミ本文を日英中へ翻訳するプレビュー機能として実装修正

### 新しいDBカラム（既存DBは起動時に自動ALTER・データは保持されます）
- stores.images / casts.photos : 複数写真（JSON配列）
- casts: bust, birthplace, style_type, alcohol, skill, face, body_style, hair（絞り込み検索用）
- reviews.cast_id : キャスト口コミ識別


---

## 11. V4 追記（2026-09-08）

### 新機能
- **RBAC（3権限）**: Super Admin（全権限）/ Club Admin（自店舗のみ）/ Cast（自分のみ）。サーバー側でリソース所有権を検証し、他店舗・他キャストのデータは API レベルで 403
- **お店とチャット**: 会話ID（u{user}-s{store} / u{user}-c{cast}）で完全分離。管理画面に未読件数バッジ表示
- **口コミ公式返信**: Club Admin（自店舗）/ Cast（自分宛て）/ Super Admin が返信可能。サイト側に「店舗からの返信」等と明記表示
- **ライトボックス**: カルーセルの中央写真をタップで全画面表示（左右操作・スワイプ・×/背景で閉じる）
- **パスワード表示切替**（ログイン/新規登録）＋ 管理画面からの**パスワード変更**機能
- キャストSNS: Instagram / TikTok / X（登録済みのみ表示）
- キャスト検索の複数選択チップ化・言語フィルター追加・出身地9地域区分

### テストアカウント（公開前に必ず削除・変更）
| 役割 | メール | パスワード |
|---|---|---|
| Super Admin | admin@tng.jp | admin123 |
| Club Admin（店舗1） | club1@tng.jp | club123 |
| Cast（MISAKI） | cast1@tng.jp | cast123 |

※ 本番では環境変数 `ADMIN_INITIAL_PASSWORD` を設定し、初回ログイン後すぐ管理画面の「パスワード変更」で変更してください。

### V3→V4 データ移行
- 既存 `data.sqlite` は削除しないでください。起動時に新カラムの自動追加（ALTER）と既存値の変換（身長・バスト・系統・会話IDなど）が冪等に実行されます
- Renderでデータを永続化するには: Renderダッシュボード → 対象サービス →「Disks」→「Add Disk」→ Mount Path に `/opt/render/project/src/data` を指定し、環境変数は不要（db.js のパスを data/ 配下に変更する場合は `DATABASE_PATH` を利用）

### 翻訳APIの本番化（推奨）
`server.js` の `POST /api/translate` 内の `naiveTranslate` を DeepL API に差し替えてください。
1. https://www.deepl.com/pro-api で無料アカウント作成（DeepL API Free = 月50万文字無料）
2. アカウントページの「認証キー」をコピー
3. Render → Environment に `DEEPL_API_KEY` として登録
4. server.js の該当箇所で `https://api-free.deepl.com/v2/translate` へ POST する実装に差替え（1関数のみ）


---

## 12. V4.1 追記（2026-09-08）

### 翻訳の根本修正（重要）
`[EN]本文` のようなダミー翻訳を廃止し、実翻訳へ切替えました。

- `DEEPL_API_KEY` 設定時: DeepL API（推奨・高品質。無料枠 月50万文字）
- 未設定時: キー不要のGoogle翻訳エンドポイントへフォールバック（本番はDeepL推奨）
- 手動修正済みの翻訳は「自動翻訳」ボタン押下時に上書き確認ダイアログを表示

#### DeepL 設定手順
1. https://www.deepl.com/pro-api →「無料で登録」でアカウント作成
2. アカウントページ →「認証キー」をコピー
3. Render → 対象サービス → Environment →「Add Environment Variable」
   - Key: `DEEPL_API_KEY` / Value: コピーした認証キー
4. Save Changes（自動再デプロイ）

### 認証まわり
- ユーザー新規作成: 初期パスワード（8文字以上）を設定、または空欄で**招待リンク発行**（7日間有効・本人がPW設定）
- ログイン画面に「パスワードを忘れた方」→ 再設定リンク発行 → 新PW設定
  ※ メール自動送信はSMTP未実装のため、現段階ではリンクを画面表示。本番は SendGrid 等の連携を推奨
- 管理画面に「パスワード変更」メニュー

### その他
- 口コミ: 200文字以上必須（文字数カウンター・ボタン無効化・サーバー側でも拒否）
- 店舗ロゴ: 管理画面アップロード → 店舗詳細・一覧カードへ自動反映（未登録時は非表示）
- キャスト詳細のチャットは「キャストとチャット」表記＋キャスト本人宛てに紐付け
- 管理画面メニュー「お知らせ・通知」に表記修正
