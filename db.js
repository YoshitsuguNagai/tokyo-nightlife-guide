/**
 * Tokyo Nightlife Guide - Database schema & seed
 * SQLite (better-sqlite3). Run: node db.js
 */
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const db = new Database(path.join(__dirname, 'data.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/* ---------- password utils ---------- */
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(pw, stored) {
  if (!stored) return false;
  const [salt, hash] = stored.split(':');
  try { return crypto.scryptSync(pw, salt, 64).toString('hex') === hash; }
  catch (e) { return false; }
}

/* ---------- schema ---------- */
db.exec(`
CREATE TABLE IF NOT EXISTS areas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  name_ja TEXT, name_en TEXT, name_zh TEXT,
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'published'
);
CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id INTEGER REFERENCES areas(id),
  name_ja TEXT, name_en TEXT, name_zh TEXT,
  desc_ja TEXT, desc_en TEXT, desc_zh TEXT,
  logo TEXT, cover_image TEXT, hue INTEGER DEFAULT 45,
  genre TEXT DEFAULT 'cabaret',
  address TEXT, google_map_url TEXT,
  open_hours TEXT, closed_days TEXT,
  phone TEXT, line_url TEXT, line_id TEXT, line_status TEXT DEFAULT 'link',
  instagram TEXT, website TEXT,
  budget_min INTEGER DEFAULT 0, budget_max INTEGER DEFAULT 0,
  charge TEXT, service_fee TEXT, payment_methods TEXT,
  foreigner_welcome INTEGER DEFAULT 1,
  english_ok INTEGER DEFAULT 0, chinese_ok INTEGER DEFAULT 0,
  credit_card_ok INTEGER DEFAULT 1, reservation_ok INTEGER DEFAULT 1,
  cast_count INTEGER DEFAULT 0,
  is_recommended INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'published',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS casts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  name TEXT, display_name TEXT, photo TEXT, hue INTEGER DEFAULT 330,
  profile_ja TEXT, profile_en TEXT, profile_zh TEXT,
  height INTEGER, hobbies TEXT, favorites TEXT,
  languages TEXT DEFAULT 'ja',
  english_ok INTEGER DEFAULT 0, chinese_ok INTEGER DEFAULT 0,
  recommend_ja TEXT, recommend_en TEXT, recommend_zh TEXT,
  sns_instagram TEXT,
  is_popular INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  status TEXT DEFAULT 'published'
);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  user_id INTEGER,
  author_name TEXT,
  rating INTEGER DEFAULT 5,
  rating_service INTEGER, rating_atmosphere INTEGER, rating_price INTEGER,
  rating_cast INTEGER, rating_foreigner INTEGER,
  title TEXT, body TEXT,
  visit_date TEXT, language TEXT DEFAULT 'en',
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  title_ja TEXT, title_en TEXT, title_zh TEXT,
  desc_ja TEXT, desc_en TEXT, desc_zh TEXT,
  event_date TEXT, start_time TEXT, end_time TEXT,
  image TEXT, hue INTEGER DEFAULT 280,
  status TEXT DEFAULT 'published'
);
CREATE TABLE IF NOT EXISTS coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER REFERENCES stores(id) ON DELETE CASCADE,
  title_ja TEXT, title_en TEXT, title_zh TEXT,
  desc_ja TEXT, desc_en TEXT, desc_zh TEXT,
  conditions_ja TEXT, conditions_en TEXT, conditions_zh TEXT,
  code TEXT, valid_until TEXT, image TEXT, hue INTEGER DEFAULT 45,
  status TEXT DEFAULT 'published'
);
CREATE TABLE IF NOT EXISTS blogs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE,
  category TEXT,
  title_ja TEXT, title_en TEXT, title_zh TEXT,
  body_ja TEXT, body_en TEXT, body_zh TEXT,
  seo_title TEXT, seo_description TEXT,
  image TEXT, hue INTEGER DEFAULT 210,
  status TEXT DEFAULT 'published',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT, email TEXT UNIQUE, password_hash TEXT,
  country TEXT, language TEXT DEFAULT 'en',
  role TEXT DEFAULT 'user',           -- user | store | admin
  store_id INTEGER,
  is_blocked INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, store_id INTEGER, cast_id INTEGER,
  direction TEXT DEFAULT 'user_to_store',  -- user_to_store | store_to_user
  body TEXT, lang_original TEXT DEFAULT 'en',
  body_ja TEXT, body_en TEXT, body_zh TEXT,
  is_read INTEGER DEFAULT 0, is_reported INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, target_type TEXT, target_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, target_type, target_id)
);
CREATE TABLE IF NOT EXISTS user_coupons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER, coupon_id INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, coupon_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER, user_id INTEGER,
  template_ja TEXT, template_en TEXT, template_zh TEXT,
  channel TEXT DEFAULT 'dm', status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY, value TEXT
);
CREATE TABLE IF NOT EXISTS password_resets (
  token TEXT PRIMARY KEY, email TEXT, expires INTEGER, used INTEGER DEFAULT 0
);
`);

/* ---------- migration: 新規カラム追加 (冪等・既存DB互換) ---------- */
function addCol(t, c, def) { try { db.prepare(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`).run(); } catch (e) {} }
addCol('stores', 'images', 'TEXT');           // 店舗写真(複数, JSON配列)
addCol('reviews', 'cast_id', 'INTEGER');      // キャスト口コミ用
['photos','bust','birthplace','style_type','alcohol','skill','face','body_style','hair']
  .forEach(c => addCol('casts', c, 'TEXT'));  // 複数写真 + 絞り込み検索項目
/* V4 追加カラム (冪等) */
addCol('casts', 'sns_tiktok', 'TEXT');
addCol('casts', 'sns_x', 'TEXT');
addCol('users', 'cast_id', 'INTEGER');        // キャストアカウントの紐付け
addCol('messages', 'conversation_id', 'TEXT');
addCol('reviews', 'reply_body', 'TEXT');
addCol('reviews', 'reply_by', 'TEXT');
addCol('reviews', 'reply_role', 'TEXT');
addCol('reviews', 'reply_at', 'TEXT');

/* ---------- seed ---------- */
const areaCount = db.prepare('SELECT COUNT(*) c FROM areas').get().c;
if (areaCount === 0) {
  console.log('Seeding database...');

  const insArea = db.prepare('INSERT INTO areas (slug,name_ja,name_en,name_zh,sort_order) VALUES (?,?,?,?,?)');
  [['roppongi','六本木','Roppongi','六本木',1],['shinjuku','新宿・歌舞伎町','Shinjuku','新宿・歌舞伎町',2],
   ['ginza','銀座','Ginza','银座',3],['shibuya','渋谷','Shibuya','涩谷',4],
   ['ueno','上野','Ueno','上野',5],['ikebukuro','池袋','Ikebukuro','池袋',6]
  ].forEach(a => insArea.run(...a));

  const insStore = db.prepare(`INSERT INTO stores
    (area_id,name_ja,name_en,name_zh,desc_ja,desc_en,desc_zh,hue,genre,address,google_map_url,open_hours,closed_days,phone,line_url,instagram,website,budget_min,budget_max,charge,service_fee,payment_methods,foreigner_welcome,english_ok,chinese_ok,credit_card_ok,reservation_ok,cast_count,is_recommended,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insStore.run(1,'クラブ ヴェール 六本木','Club VELVET Roppongi','VELVET俱乐部 六本木',
    '六本木の中心に位置するラグジュアリーキャバクラ。英語・中国語対応スタッフ常駐で、海外からのお客様にも安心してお楽しみいただけます。',
    'A luxury club in the heart of Roppongi. English & Chinese speaking staff make it easy and comfortable for international guests.',
    '位于六本木中心的高级俱乐部。常驻会英语和中文的工作人员，让海外客人也能安心享受。',
    45,'cabaret','東京都港区六本木3-11-6','https://maps.google.com/?q=Roppongi+Tokyo','20:00 - 01:00','日曜・祝日','03-1234-0001','https://line.me/R/ti/p/@velvet','https://instagram.com/velvet_roppongi','https://example.com',30000,80000,'¥10,000','20%','Cash, VISA, Master, AMEX',1,1,1,1,1,25,1,1);
  insStore.run(2,'ラウンジ 琥珀 歌舞伎町','Lounge KOHAKU Kabukicho','琥珀酒廊 歌舞伎町',
    '歌舞伎町の隠れ家的ラウンジ。落ち着いた大人の空間で上質なひとときを。',
    'A hidden lounge in Kabukicho. A refined adult space for a quality evening.',
    '歌舞伎町的隐秘酒廊。在沉稳的成人空间中度过高品质的时光。',
    30,'lounge','東京都新宿区歌舞伎町1-2-3','https://maps.google.com/?q=Kabukicho+Shinjuku','19:00 - 24:00','不定休','03-1234-0002','https://line.me/R/ti/p/@kohaku','https://instagram.com/kohaku_kabukicho','',20000,50000,'¥8,000','15%','Cash, VISA, Master',1,1,0,1,1,18,1,2);
  insStore.run(3,'銀座 クラブ ルミエール','Club LUMIERE Ginza','LUMIERE俱乐部 银座',
    '銀座の格式高い会員制クラブ。ビジネス接待や特別な夜に。',
    'A prestigious members club in Ginza, perfect for business entertainment and special nights.',
    '银座的高级会员制俱乐部。适合商务接待和特别的夜晚。',
    50,'cabaret','東京都中央区銀座8-5-6','https://maps.google.com/?q=Ginza+Tokyo','20:00 - 01:00','土日祝','03-1234-0003','https://line.me/R/ti/p/@lumiere','','',50000,150000,'¥20,000','25%','VISA, Master, AMEX, JCB',1,1,1,1,1,30,1,3);
  insStore.run(4,'クラブ ネオン 渋谷','Club NEON Shibuya','NEON俱乐部 涩谷',
    '渋谷のカジュアルでフレンドリーなクラブ。初めての方にもおすすめ。',
    'A casual, friendly club in Shibuya. Great for first-timers.',
    '涩谷轻松友好的俱乐部。推荐初次体验的客人。',
    300,'club','東京都渋谷区道玄坂2-10-7','https://maps.google.com/?q=Shibuya+Tokyo','19:00 - 25:00','年中無休','03-1234-0004','','https://instagram.com/neon_shibuya','',15000,40000,'¥6,000','10%','Cash, VISA',1,1,0,1,0,20,0,4);
  insStore.run(5,'上野 スカイラウンジ','Ueno Sky Lounge','上野天空酒廊',
    '上野の夜景を望むスカイラウンジ。リーズナブルに楽しめる。',
    'A sky lounge overlooking Ueno. Affordable luxury with a view.',
    '可以眺望上野夜景的天空酒廊。价格实惠。',
    220,'lounge','東京都台東区上野4-1-2','https://maps.google.com/?q=Ueno+Tokyo','18:00 - 24:00','月曜','03-1234-0005','','','',10000,30000,'¥5,000','10%','Cash',1,0,1,0,1,12,0,5);
  insStore.run(6,'池袋 クラブ ミラージュ','Club MIRAGE Ikebukuro','MIRAGE俱乐部 池袋',
    '池袋の人気クラブ。元気なキャストと楽しい夜を。',
    'A popular club in Ikebukuro with a lively cast.',
    '池袋的人气俱乐部。与活泼的公关共度欢乐夜晚。',
    260,'club','東京都豊島区西池袋1-20-5','https://maps.google.com/?q=Ikebukuro+Tokyo','19:00 - 01:00','年中無休','03-1234-0006','','','',12000,35000,'¥6,000','15%','Cash, VISA, Master',1,1,1,1,1,22,0,6);

  const insCast = db.prepare(`INSERT INTO casts (store_id,name,display_name,photo,photos,hue,profile_ja,profile_en,profile_zh,height,hobbies,favorites,languages,english_ok,chinese_ok,recommend_ja,recommend_en,recommend_zh,sns_instagram,is_popular,sort_order,status,bust,birthplace,style_type,alcohol,skill,face,body_style,hair) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insCast.run(1,'美咲','MISAKI','','[]',330,'六本木店No.1。英語ペラペラで海外のお客様に大人気。','No.1 at Roppongi. Fluent in English and loved by international guests.','六本木店No.1。英语流利，深受海外客人喜爱。',162,'旅行・ワイン','シャンパン','ja,en',1,0,'英語OK! 笑顔が素敵な人気キャスト','English OK! Beloved for her smile','会说英语！以笑容著称的人气公关','https://instagram.com/misaki',1,1,'published','D','関東','綺麗','強い','話し上手','綺麗系','スレンダー','ロング');
  insCast.run(1,'麗奈','REINA','','[]',320,'中国語対応可能。落ち着いた大人の魅力。','Speaks Chinese. A calm, mature charm.','会中文。成熟稳重的魅力。',158,'カラオケ','日本酒','ja,zh',0,1,'中国語OKのおすすめキャスト','Recommended: Chinese OK','推荐：会中文','',1,2,'published','C','関東','セクシー','飲む','聞き上手','クール系','普通','ミディアム');
  insCast.run(1,'あんな','ANNA','','[]',340,'明るく元気なムードメーカー。','A bright, cheerful mood-maker.','开朗活泼的气氛担当。',160,'ダンス','カクテル','ja',0,0,'ノリの良さNo.1','Best energy in the club','气氛最好的公关','',0,3,'published','B','関東','ギャル','強い','盛り上げ上手','可愛い系','普通','ミディアム');
  insCast.run(2,'さくら','SAKURA','','[]',350,'歌舞伎町の癒やし系。英語勉強中。','The soothing presence of Kabukicho. Studying English.','歌舞伎町的治愈系。正在学习英语。',155,'読書','紅茶','ja',0,0,'優しい接客でリピート多数','Gentle service, many repeat guests','服务温柔，回头客众多','',1,1,'published','C','関東','童顔','飲めない','聞き上手','癒やし系','スレンダー','ロング');
  insCast.run(2,'りん','RIN','','[]',10,'元モデルのスタイル抜群キャスト。','Former model with stunning style.','前模特，身材出众。',168,'ヨガ','ワイン','ja,en',1,0,'スタイル抜群!','Amazing style','身材超棒！','',1,2,'published','D','関東','綺麗','飲む','接待上手','綺麗系','モデル体型','ロング');
  insCast.run(3,'ゆり','YURI','','[]',45,'銀座の高級感あふれるキャスト。英語・中国語OK。','Elegant Ginza cast. English & Chinese OK.','银座的高贵公关。会英语和中文。',163,'ゴルフ','シャンパン','ja,en,zh',1,1,'トリリンガルの高級キャスト','Trilingual premium cast','会三种语言的高级公关','',1,1,'published','D','関東','綺麗','飲む','ゴルフ','綺麗系','スレンダー','ミディアム');
  insCast.run(4,'もも','MOMO','','[]',300,'渋谷の元気印!英語OK。','Shibuya’s bundle of energy! English OK.','涩谷的元气担当！会英语。',157,'ショッピング','スイーツ','ja,en',1,0,'初めての方におすすめ','Great for first-timers','推荐初次体验的客人','',1,1,'published','F','関西','ギャル','強い','盛り上げ上手','可愛い系','グラマー','ボブ');
  insCast.run(6,'なな','NANA','','[]',260,'池袋の人気者。中国語対応。','Ikebukuro favorite. Chinese OK.','池袋的人气公关。会中文。',159,'アニメ','焼酎','ja,zh',0,1,'中国語OK','Chinese OK','会中文','',1,1,'published','C','海外','ハーフ顔','飲む','話し上手','ハーフ系','普通','ショート');
  /* テスト用仮画像 (Cloudinaryの公式サンプル画像を使用・管理画面から差替え可能) */
  const DP = 'https://res.cloudinary.com/demo/image/upload/w_900,h_620,c_fill/';
  const S1 = JSON.stringify([DP + 'sample.jpg', DP + 'sample2.jpg', DP + 'samples/food/spices.jpg']);
  const S2 = JSON.stringify([DP + 'samples/landscapes/beach-boat.jpg', DP + 'sample.jpg', DP + 'samples/food/dessert.jpg']);
  const S3 = JSON.stringify([DP + 'samples/landscapes/nature-mountains.jpg', DP + 'samples/food/pot-mussels.jpg', DP + 'sample2.jpg']);
  const C1 = JSON.stringify([DP + 'sample.jpg', DP + 'samples/animals/cat.jpg', DP + 'samples/people/bicycle.jpg', DP + 'sample2.jpg']);
  const C2 = JSON.stringify([DP + 'sample2.jpg', DP + 'samples/people/smiling-man.jpg', DP + 'samples/food/spices.jpg']);
  db.prepare("UPDATE stores SET images=? WHERE id IN (1,2)").run(S1);
  db.prepare("UPDATE stores SET images=? WHERE id IN (3,4)").run(S2);
  db.prepare("UPDATE stores SET images=? WHERE id IN (5,6)").run(S3);
  [1,2,3].forEach(i => db.prepare("UPDATE casts SET photos=? WHERE id=?").run(C1, i));
  [4,5,6,7,8].forEach(i => db.prepare("UPDATE casts SET photos=? WHERE id=?").run(C2, i));
  db.prepare("UPDATE events SET image=?").run(DP + 'samples/landscapes/beach-boat.jpg');
  db.prepare("UPDATE coupons SET image=?").run(DP + 'samples/food/dessert.jpg');

  const insReview = db.prepare(`INSERT INTO reviews (store_id,author_name,rating,rating_service,rating_atmosphere,rating_price,rating_cast,rating_foreigner,title,body,visit_date,language,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  insReview.run(1,'Michael (USA)',5,5,5,4,5,5,'Amazing night in Roppongi!','Staff spoke perfect English and made everything easy. The girls were friendly and the atmosphere was luxurious. Highly recommended for foreigners!', '2026-08-10','en','approved');
  insReview.run(1,'王先生 (中国)',5,5,4,4,5,5,'非常棒的地方','工作人员会说中文，沟通完全没有问题。环境很高级，下次还会再来。','2026-08-05','zh','approved');
  insReview.run(1,'田中太郎',4,4,5,3,4,4,'落ち着いた高級店','六本木の中でも落ち着いた雰囲気。料金はやや高めですが納得のクオリティ。','2026-07-28','ja','approved');
  insReview.run(2,'David (UK)',4,4,4,4,5,4,'Hidden gem in Kabukicho','Cozy lounge with a relaxed vibe. SAKURA was wonderful. A bit hard to find but worth it.','2026-08-12','en','approved');
  insReview.run(3,'James (Australia)',5,5,5,3,5,5,'True Ginza luxury','Expensive but absolutely worth it. YURI spoke three languages and the service was impeccable.','2026-08-01','en','approved');
  insReview.run(4,'Kevin (Korea)',4,4,4,5,4,4,'Fun and casual','Good prices and friendly staff. MOMO was super fun to talk with. Great for first-timers.','2026-08-15','en','approved');

  const insEvent = db.prepare(`INSERT INTO events (store_id,title_ja,title_en,title_zh,desc_ja,desc_en,desc_zh,event_date,start_time,end_time,hue,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const today = new Date().toISOString().slice(0,10);
  const week = new Date(Date.now()+5*86400000).toISOString().slice(0,10);
  insEvent.run(1,'今夜限定シャンパンナイト','Tonight Only: Champagne Night','今晚限定香槟之夜','今夜だけの特別シャンパンイベント。','Special champagne event, tonight only.','今晚限定的特别香槟活动。',today,'20:00','01:00',280,'published');
  insEvent.run(2,'ゲストDJナイト','Guest DJ Night','嘉宾DJ之夜','人気DJが登場するスペシャルナイト。','A special night with a popular guest DJ.','人气DJ登场的特别之夜。',today,'21:00','24:00',200,'published');
  insEvent.run(3,'バースデーイベント','Birthday Event','生日活动','今週末はYURIのバースデーイベント!','This weekend: YURI’s birthday event!','本周末是YURI的生日活动！',week,'20:00','01:00',45,'published');

  const insCoupon = db.prepare(`INSERT INTO coupons (store_id,title_ja,title_en,title_zh,desc_ja,desc_en,desc_zh,conditions_ja,conditions_en,conditions_zh,code,valid_until,hue,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const until = new Date(Date.now()+30*86400000).toISOString().slice(0,10);
  insCoupon.run(1,'初回来店 10%OFF','First Visit 10% OFF','首次光临9折','初めてのご来店で総額10%OFF。','10% off your total bill on your first visit.','首次光临，总消费9折。','初回来店の方限定','First-time visitors only','仅限首次光临的客人','WELCOME10',until,45,'published');
  insCoupon.run(2,'テーブルチャージ無料','Free Table Charge','免台费','クーポン提示でテーブルチャージ無料。','Show this coupon for a free table charge.','出示此券可免台费。','1組1回限り','Once per group','每组限用一次','FREETABLE',until,30,'published');
  insCoupon.run(4,'シャンパン1本サービス','Free Bottle of Champagne','赠送香槟一瓶','3名様以上のご来店でシャンパン1本サービス。','Free champagne bottle for groups of 3+.','3人以上光临赠送香槟一瓶。','3名様以上','Groups of 3 or more','3人以上','CHAMPAGNE',until,300,'published');

  const insBlog = db.prepare(`INSERT INTO blogs (slug,category,title_ja,title_en,title_zh,body_ja,body_en,body_zh,seo_title,seo_description,hue,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  insBlog.run('tokyo-nightlife-beginners-guide','Tokyo Nightlife','東京ナイトライフ入門ガイド','Tokyo Nightlife: A Beginner’s Guide','东京夜生活入门指南',
    '初めて東京の夜を楽しむ方へ。キャバクラの基本システム、料金、マナーを解説します。\n\n■ キャバクラとは\nキャストとお酒を楽しむ日本独自の夜遊びです。\n\n■ 料金システム\nセット料金+チャージ+税金・サービス料が基本です。',
    'A guide for first-timers in Tokyo at night: how clubs work, pricing, and etiquette.\n\n■ What is a club?\nA uniquely Japanese nightlife experience where you drink and chat with hostesses.\n\n■ Pricing\nSet fee + table charge + tax/service is standard.',
    '为第一次体验东京夜生活的客人准备的指南：俱乐部的基本制度、价格和礼仪。\n\n■ 什么是俱乐部\n与公关一起喝酒聊天的日本特色夜生活。\n\n■ 收费制度\n基本为套餐费+台费+税费/服务费。',
    'Tokyo Nightlife Beginner Guide | Tokyo Nightlife Guide','Learn how Japanese clubs work: pricing, etiquette and tips for foreigners.',210,'published');
  insBlog.run('best-clubs-roppongi','Roppongi','六本木おすすめクラブ5選','Best 5 Clubs in Roppongi','六本木推荐俱乐部5选',
    '外国人におすすめの六本木クラブを厳選しました。\n\n1. Club VELVET — 英語OKの高級店\n2. ...',
    'Our handpicked clubs in Roppongi for international guests.\n\n1. Club VELVET — luxury, English OK\n2. ...',
    '精选适合外国客人的六本木俱乐部。\n\n1. Club VELVET — 高级店，会英语\n2. ...',
    'Best Clubs in Roppongi | Tokyo Nightlife Guide','Top clubs in Roppongi for foreigners, with English support.',45,'published');
  insBlog.run('how-to-enjoy-japanese-clubs','How to Enjoy','日本のクラブの楽しみ方','How to Enjoy Japanese Clubs','如何享受日本俱乐部',
    '予約から会計まで、日本のクラブの流れを説明します。\n\n1. 予約 or 直接来店\n2. 席に案内\n3. キャストと会話を楽しむ\n4. 会計',
    'From reservation to payment: the flow of a Japanese club night.\n\n1. Reserve or walk in\n2. Get seated\n3. Chat with the cast\n4. Pay the bill',
    '从预约到结账，介绍日本俱乐部的流程。\n\n1. 预约或直接到店\n2. 入座\n3. 与公关聊天\n4. 结账',
    'How to Enjoy Japanese Clubs | Tokyo Nightlife Guide','Step-by-step guide to enjoying clubs in Japan.',320,'published');

  /* admin + demo accounts */
  const insUser = db.prepare('INSERT INTO users (name,email,password_hash,country,language,role,store_id,cast_id) VALUES (?,?,?,?,?,?,?,?)');
  insUser.run('Administrator','admin@tng.jp',hashPassword(process.env.ADMIN_INITIAL_PASSWORD || 'admin123'),'JP','ja','admin',null,null);
  insUser.run('Demo User','user@tng.jp',hashPassword('user123'),'US','en','user',null,null);
  insUser.run('VELVET Club Admin','club1@tng.jp',hashPassword('club123'),'JP','ja','store',1,null);
  insUser.run('KOHAKU Club Admin','club2@tng.jp',hashPassword('club123'),'JP','ja','store',2,null);
  insUser.run('MISAKI (Cast)','cast1@tng.jp',hashPassword('cast123'),'JP','ja','cast',1,1);

  const insSet = db.prepare('INSERT INTO settings (key,value) VALUES (?,?)');
  [['site_name','Tokyo Nightlife Guide'],['site_name_ja','東京ナイトライフガイド'],['site_name_zh','东京夜生活指南'],
   ['color_primary','#c9a227'],['color_bg','#0a0a0a'],['seo_title','Tokyo Nightlife Guide | Find the Best Clubs in Tokyo'],
   ['seo_description','Discover the best clubs & nightlife in Tokyo. English & Chinese support. Roppongi, Shinjuku, Ginza and more.'],
   ['sns_instagram',''],['sns_x',''],['line_url','']
  ].forEach(s => insSet.run(...s));

  console.log('Seed complete.');
}

/* ---------- migration: 旧ジャンル値→新体系 (冪等・既存データ互換) ---------- */
db.exec("UPDATE stores SET genre='cabaret' WHERE genre IN ('cabaret','cabaret')");
db.exec("UPDATE stores SET genre='club' WHERE genre='casual'");

/* V4 migrations (冪等・既存データ保持) */
db.exec("UPDATE casts SET birthplace='関東' WHERE birthplace IN ('東京','神奈川','埼玉','千葉')");
db.exec("UPDATE casts SET birthplace='関西' WHERE birthplace IN ('大阪','京都','兵庫')");
db.exec("UPDATE casts SET style_type='綺麗' WHERE style_type IN ('清楚','モデル','お姉さん')");
db.exec("UPDATE casts SET style_type='童顔' WHERE style_type IN ('可愛い','癒やし')");
db.exec("UPDATE casts SET alcohol='飲む' WHERE alcohol='普通'");
db.exec("UPDATE casts SET alcohol='飲めない' WHERE alcohol='弱い'");
db.exec("UPDATE casts SET skill='接待上手' WHERE skill IN ('ベテラン','経験者')");
db.exec("UPDATE casts SET skill='話し上手' WHERE skill IN ('初心者','未経験')");
db.exec("UPDATE casts SET hair='ミディアム' WHERE hair='ボブ'");
db.exec("UPDATE casts SET bust='B' WHERE bust='〜79'");
db.exec("UPDATE casts SET bust='C' WHERE bust='80〜84'");
db.exec("UPDATE casts SET bust='D' WHERE bust='85〜89'");
db.exec("UPDATE casts SET bust='F' WHERE bust='90〜94'");
db.exec("UPDATE casts SET bust='H以上' WHERE bust='95〜'");
db.exec("UPDATE messages SET conversation_id='u'||user_id||'-c'||cast_id WHERE conversation_id IS NULL AND cast_id IS NOT NULL");
db.exec("UPDATE messages SET conversation_id='u'||user_id||'-s'||store_id WHERE conversation_id IS NULL AND store_id IS NOT NULL");

module.exports = { db, hashPassword, verifyPassword };

if (require.main === module) {
  console.log('Database ready: data.sqlite');
  console.log('Admin login: admin@tng.jp / admin123');
  console.log('Demo user:   user@tng.jp / user123');
}
