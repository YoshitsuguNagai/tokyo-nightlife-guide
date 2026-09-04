# Tokyo Nightlife Guide — Phase 1
外国人向けキャバクラ検索・送客ポータル (日/EN/中文 3言語対応)

## 起動方法
```bash
npm install     # 依存: express, better-sqlite3 のみ
node server.js  # 初回起動時にDB(data.sqlite)自動作成+シード
```
- サイト: http://localhost:3000/
- 管理画面: http://localhost:3000/admin.html
- 管理ログイン: admin@tng.jp / admin123  ※運用前に必ず変更
- デモユーザー: user@tng.jp / user123

## 構成
- server.js ... Express API(認証/公開API/管理CRUD)
- db.js ... SQLiteスキーマ12テーブル+シードデータ
- public/index.html ... ユーザー向けSPA(モバイルファースト)
- public/admin.html ... 管理画面(WordPress感覚のCRUD)

## Phase 1 実装済み
店舗検索(エリア/ジャンル/予算/言語/外国人歓迎/カード/人気順)、店舗詳細(About/Girls/Reviews/Events/Coupons/Accessタブ+固定CTA)、
キャスト詳細、口コミ(投稿→管理者承認制)、3言語切替(DB別フィールド)、ユーザー登録/ログイン(scryptハッシュ+トークン)、
お気に入り、クーポン取得、簡易DM(3言語翻訳フィールド)、イベント、ブログ、管理画面全CRUD。

## Phase 2 以降の拡張ポイント
- 翻訳: server.js の naiveTranslate を本番翻訳APIに差替え(テーブルに ja/en/zh 3カラム確保済み)
- LINE: stores.line_url/line_id/line_status 確保済み → Messaging API連携へ
- 予約/決済/分析: reservations等のテーブル追加で拡張可能
