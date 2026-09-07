/**
 * Tokyo Nightlife Guide - API server (Phase 1 改善版)
 * Express + SQLite. 公開サイト / 管理画面 / JSON API / 画像アップロード
 *
 * 環境変数 (Render > Environment Variables):
 *   PORT                       ... Renderが自動設定
 *   CLOUDINARY_CLOUD_NAME      ... 画像の永続保存に使用 (未設定時はローカル保存=再デプロイで消えます)
 *   CLOUDINARY_UPLOAD_PRESET   ... CloudinaryのUnsignedプリセット名
 */
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { db, hashPassword, verifyPassword } = require('./db');

const app = express();
app.use(express.json({ limit: '12mb' })); // base64画像アップロード許容
app.use(express.static(path.join(__dirname, 'public')));
const UPLOAD_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ---------- 簡易翻訳 (本番は翻訳APIに差替え。README参照) ---------- */
const DICT = [
  ['こんにちは', 'Hello', '你好'], ['ありがとう', 'Thank you', '谢谢'], ['ありがとうございます', 'Thank you very much', '非常感谢'],
  ['予約', 'Reservation', '预约'], ['今夜', 'Tonight', '今晚'], ['イベント', 'Event', '活动'], ['クーポン', 'Coupon', '优惠券'],
  ['お待ちしています', 'We look forward to seeing you', '期待您的光临'], ['ご来店', 'your visit', '光临'],
  ['初回', 'First visit', '首次'], ['無料', 'Free', '免费'], ['本日', 'Today', '今天'], ['限定', 'Limited', '限定'],
  ['キャンペーン', 'Campaign', '优惠活动'], ['特典', 'Special offer', '特典'], ['おすすめ', 'Recommended', '推荐'],
  ['ようこそ', 'Welcome', '欢迎'], ['開催', 'Held', '举办'], ['店舗', 'Club', '店铺'], ['キャスト', 'Cast', '公关']
];
function naiveTranslate(text, from, to) {
  if (from === to || !text) return text || '';
  let out = String(text);
  const pick = (row, l) => l === 'ja' ? row[0] : l === 'en' ? row[1] : row[2];
  for (const row of DICT) { const s = pick(row, from), d = pick(row, to); if (s && s !== d) out = out.split(s).join(d); }
  return out === text ? `[${to.toUpperCase()}] ` + text : out;
}

/* ---------- auth ---------- */
function makeToken(uid) {
  const t = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO tokens (token,user_id) VALUES (?,?)').run(t, uid);
  return t;
}
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const row = t && db.prepare('SELECT u.* FROM tokens tk JOIN users u ON u.id=tk.user_id WHERE tk.token=?').get(t);
  if (!row || row.is_blocked) return res.status(401).json({ error: 'unauthorized' });
  req.user = row; next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}

/* ---------- utils ---------- */
const clean = s => String(s ?? '').slice(0, 8000);
const int = v => parseInt(v, 10) || 0;
function storeWithStats(s) {
  const r = db.prepare(`SELECT ROUND(AVG(rating),1) avg, COUNT(*) cnt FROM reviews WHERE store_id=? AND cast_id IS NULL AND status='approved'`).get(s.id);
  const area = s.area_id ? db.prepare('SELECT * FROM areas WHERE id=?').get(s.area_id) : null;
  return { ...s, rating_avg: r.avg || 0, review_count: r.cnt, area };
}

/* ---------- 画像アップロード (Cloudinary優先 / 未設定時ローカル) ---------- */
app.post('/api/upload', auth, adminOnly, async (req, res) => {
  try {
    const { filename, data } = req.body || {};
    const m = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,(.+)$/.exec(data || '');
    if (!m) return res.status(400).json({ error: '画像データ(png/jpg/webp/gif)を選択してください' });
    const buf = Buffer.from(m[3], 'base64');
    if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: '画像は5MB以下にしてください' });
    const cloud = process.env.CLOUDINARY_CLOUD_NAME, preset = process.env.CLOUDINARY_UPLOAD_PRESET;
    if (cloud && preset) {
      const fd = new FormData();
      fd.append('file', new Blob([buf], { type: m[1] }), (filename || 'image').replace(/[^\w.\-]/g, '_'));
      fd.append('upload_preset', preset);
      const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: fd }).then(r => r.json());
      if (r.secure_url) return res.json({ url: r.secure_url, storage: 'cloudinary' });
      return res.status(502).json({ error: 'Cloudinaryアップロード失敗: ' + (r.error && r.error.message || 'unknown') });
    }
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    const name = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
    res.json({ url: '/uploads/' + name, storage: 'local', warning: 'ローカル保存のため再デプロイで消えます。Cloudinaryを設定してください(README参照)。' });
  } catch (e) { res.status(500).json({ error: 'upload failed' }); }
});

/* ---------- PUBLIC API ---------- */
app.get('/api/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  res.json(Object.fromEntries(rows.map(r => [r.key, r.value])));
});
app.get('/api/areas', (req, res) => res.json(db.prepare(`SELECT * FROM areas WHERE status='published' ORDER BY sort_order`).all()));

app.get('/api/stores', (req, res) => {
  const q = req.query;
  let sql = `SELECT * FROM stores WHERE status='published'`;
  const p = [];
  if (q.area)  { sql += ' AND area_id=?'; p.push(int(q.area)); }
  if (q.genre) { sql += ' AND genre=?'; p.push(clean(q.genre)); }
  if (q.lang === 'en') sql += ' AND english_ok=1';
  if (q.lang === 'zh') sql += ' AND chinese_ok=1';
  if (q.foreigner === '1') sql += ' AND foreigner_welcome=1';
  if (q.card === '1') sql += ' AND credit_card_ok=1';
  if (q.budget) { // "0-50000" | "50000-100000" | "100000-" : 価格帯が重なる店舗を抽出
    const [lo, hi] = String(q.budget).split('-');
    if (lo) { sql += ' AND budget_max>=?'; p.push(int(lo)); }
    if (hi) { sql += ' AND budget_min<=?'; p.push(int(hi)); }
  }
  if (q.q) { sql += ' AND (name_ja LIKE ? OR name_en LIKE ? OR name_zh LIKE ?)'; const w = '%' + clean(q.q) + '%'; p.push(w, w, w); }
  if (q.recommended === '1') sql += ' AND is_recommended=1';
  sql += q.sort === 'popular'
    ? ` ORDER BY (SELECT COUNT(*) FROM reviews r WHERE r.store_id=stores.id AND r.status='approved') DESC, sort_order`
    : ' ORDER BY is_recommended DESC, sort_order';
  res.json(db.prepare(sql).all(...p).map(storeWithStats));
});

app.get('/api/stores/:id', (req, res) => {
  const s = db.prepare(`SELECT * FROM stores WHERE id=? AND status='published'`).get(int(req.params.id));
  if (!s) return res.status(404).json({ error: 'not found' });
  const out = storeWithStats(s);
  out.casts = db.prepare(`SELECT * FROM casts WHERE store_id=? AND status='published' ORDER BY sort_order`).all(s.id);
  out.reviews = db.prepare(`SELECT * FROM reviews WHERE store_id=? AND cast_id IS NULL AND status='approved' ORDER BY created_at DESC`).all(s.id);
  out.events = db.prepare(`SELECT * FROM events WHERE store_id=? AND status='published' ORDER BY event_date`).all(s.id);
  out.coupons = db.prepare(`SELECT * FROM coupons WHERE store_id=? AND status='published'`).all(s.id);
  res.json(out);
});

app.get('/api/casts', (req, res) => {
  const q = req.query;
  let sql = `SELECT c.*, s.name_ja store_name_ja, s.name_en store_name_en, s.name_zh store_name_zh, s.area_id store_area_id FROM casts c JOIN stores s ON s.id=c.store_id WHERE c.status='published' AND s.status='published'`;
  const p = [];
  if (q.lang === 'en') sql += ' AND c.english_ok=1';
  if (q.lang === 'zh') sql += ' AND c.chinese_ok=1';
  if (q.popular === '1') sql += ' AND c.is_popular=1';
  if (q.area)      { sql += ' AND s.area_id=?'; p.push(int(q.area)); }
  if (q.height_min){ sql += ' AND c.height>=?'; p.push(int(q.height_min)); }
  if (q.height_max){ sql += ' AND c.height<=?'; p.push(int(q.height_max)); }
  if (q.bust)      { sql += ' AND c.bust=?'; p.push(clean(q.bust)); }
  ['birthplace','style_type','alcohol','skill','face','body_style','hair'].forEach(k => {
    if (q[k]) { sql += ` AND c.${k}=?`; p.push(clean(q[k])); }
  });
  res.json(db.prepare(sql + ' ORDER BY c.is_popular DESC, c.sort_order').all(...p));
});
app.get('/api/casts/:id', (req, res) => {
  const c = db.prepare(`SELECT c.*, s.name_ja store_name_ja, s.name_en store_name_en, s.name_zh store_name_zh FROM casts c JOIN stores s ON s.id=c.store_id WHERE c.id=? AND c.status='published'`).get(int(req.params.id));
  if (!c) return res.status(404).json({ error: 'not found' });
  c.reviews = db.prepare(`SELECT * FROM reviews WHERE cast_id=? AND status='approved' ORDER BY created_at DESC`).all(c.id);
  const r = db.prepare(`SELECT ROUND(AVG(rating),1) avg, COUNT(*) cnt FROM reviews WHERE cast_id=? AND status='approved'`).get(c.id);
  c.rating_avg = r.avg || 0; c.review_count = r.cnt;
  c.others = db.prepare(`SELECT c2.id, c2.display_name, c2.name, c2.photo, c2.hue, c2.english_ok, c2.chinese_ok, c2.height, c2.recommend_ja, c2.recommend_en, c2.recommend_zh, s2.name_ja store_name_ja, s2.name_en store_name_en, s2.name_zh store_name_zh FROM casts c2 JOIN stores s2 ON s2.id=c2.store_id WHERE c2.store_id=? AND c2.id!=? AND c2.status='published' ORDER BY c2.is_popular DESC, c2.sort_order LIMIT 8`).all(c.store_id, c.id);
  res.json(c);
});

app.get('/api/events', (req, res) => {
  let sql = `SELECT e.*, s.name_en store_name_en, s.name_ja store_name_ja, s.name_zh store_name_zh FROM events e JOIN stores s ON s.id=e.store_id WHERE e.status='published' AND s.status='published'`;
  if (req.query.when === 'today') sql += ` AND e.event_date=date('now','localtime')`;
  else if (req.query.when === 'week') sql += ` AND e.event_date BETWEEN date('now','localtime') AND date('now','localtime','+7 day')`;
  res.json(db.prepare(sql + ' ORDER BY e.event_date').all());
});
app.get('/api/events/:id', (req, res) => {
  const e = db.prepare(`SELECT e.*, s.name_en store_name_en, s.name_ja store_name_ja, s.name_zh store_name_zh, s.address store_address, s.open_hours store_hours, s.budget_min, s.budget_max, s.hue store_hue FROM events e JOIN stores s ON s.id=e.store_id WHERE e.id=? AND e.status='published'`).get(int(req.params.id));
  if (!e) return res.status(404).json({ error: 'not found' });
  res.json(e);
});

app.get('/api/coupons', (req, res) => res.json(
  db.prepare(`SELECT c.*, s.name_en store_name_en, s.name_ja store_name_ja, s.name_zh store_name_zh FROM coupons c JOIN stores s ON s.id=c.store_id WHERE c.status='published' AND s.status='published' ORDER BY c.id DESC`).all()));
app.get('/api/blogs', (req, res) => res.json(db.prepare(`SELECT id,slug,category,title_ja,title_en,title_zh,seo_description,hue,created_at FROM blogs WHERE status='published' ORDER BY created_at DESC`).all()));
app.get('/api/blogs/:slug', (req, res) => {
  const b = db.prepare(`SELECT * FROM blogs WHERE slug=? AND status='published'`).get(clean(req.params.slug));
  if (!b) return res.status(404).json({ error: 'not found' });
  res.json(b);
});
app.get('/api/reviews', (req, res) => res.json(
  db.prepare(`SELECT r.*, s.name_en store_name_en, s.name_ja store_name_ja, s.name_zh store_name_zh FROM reviews r JOIN stores s ON s.id=r.store_id WHERE r.status='approved' ORDER BY r.created_at DESC LIMIT 50`).all()));
app.get('/api/reviews/summary', (req, res) => {
  const r = db.prepare(`SELECT ROUND(AVG(rating),1) avg, COUNT(*) cnt FROM reviews WHERE status='approved'`).get();
  res.json({ avg: r.avg || 0, cnt: r.cnt });
});

/* 口コミ投稿 (公開は管理者承認後) */
app.post('/api/reviews', (req, res) => {
  const b = req.body;
  if (!b.store_id || !b.body) return res.status(400).json({ error: 'missing fields' });
  if (!b.cast_id && !b.store_id) return res.status(400).json({ error: 'missing fields' });
  db.prepare(`INSERT INTO reviews (store_id,cast_id,user_id,author_name,rating,title,body,visit_date,language,status) VALUES (?,?,?,?,?,?,?,?,?,'pending')`)
    .run(int(b.store_id) || null, int(b.cast_id) || null, int(b.user_id) || null, clean(b.author_name || 'Guest'), Math.min(5, Math.max(1, int(b.rating) || 5)), clean(b.title), clean(b.body), clean(b.visit_date), clean(b.language || 'en'));
  res.json({ ok: true, message: 'pending_approval' });
});

/* 翻訳 */
app.post('/api/translate', (req, res) => {
  const { text, from, to } = req.body;
  res.json({ translated: naiveTranslate(clean(text), clean(from || 'ja'), clean(to || 'en')) });
});

/* ---------- AUTH ---------- */
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, country, language } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email & password required' });
  try {
    const r = db.prepare('INSERT INTO users (name,email,password_hash,country,language) VALUES (?,?,?,?,?)')
      .run(clean(name), clean(email).toLowerCase(), hashPassword(String(password)), clean(country), clean(language || 'en'));
    res.json({ token: makeToken(r.lastInsertRowid), user: { id: r.lastInsertRowid, name, email, role: 'user' } });
  } catch (e) { res.status(400).json({ error: 'email already registered' }); }
});
app.post('/api/auth/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(clean(req.body.email).toLowerCase());
  if (!u || !verifyPassword(String(req.body.password), u.password_hash) || u.is_blocked)
    return res.status(401).json({ error: 'invalid credentials' });
  res.json({ token: makeToken(u.id), user: { id: u.id, name: u.name, email: u.email, role: u.role, language: u.language } });
});
app.get('/api/me', auth, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id, name: u.name, email: u.email, country: u.country, language: u.language, role: u.role,
    favorites: db.prepare('SELECT * FROM favorites WHERE user_id=?').all(u.id),
    coupons: db.prepare(`SELECT uc.id uid, c.* FROM user_coupons uc JOIN coupons c ON c.id=uc.coupon_id WHERE uc.user_id=?`).all(u.id),
    messages: db.prepare('SELECT * FROM messages WHERE user_id=? ORDER BY created_at DESC').all(u.id)
  });
});

/* ---------- USER actions ---------- */
app.post('/api/favorites', auth, (req, res) => {
  const { target_type, target_id } = req.body;
  const ex = db.prepare('SELECT id FROM favorites WHERE user_id=? AND target_type=? AND target_id=?').get(req.user.id, target_type, int(target_id));
  if (ex) { db.prepare('DELETE FROM favorites WHERE id=?').run(ex.id); return res.json({ favorited: false }); }
  db.prepare('INSERT INTO favorites (user_id,target_type,target_id) VALUES (?,?,?)').run(req.user.id, clean(target_type), int(target_id));
  res.json({ favorited: true });
});
app.post('/api/coupons/:id/get', auth, (req, res) => {
  try { db.prepare('INSERT INTO user_coupons (user_id,coupon_id) VALUES (?,?)').run(req.user.id, int(req.params.id)); } catch (e) {}
  res.json({ ok: true });
});
app.post('/api/messages', auth, (req, res) => {
  const { store_id, cast_id, body } = req.body;
  if (!store_id || !body) return res.status(400).json({ error: 'missing fields' });
  const lang = req.user.language || 'en';
  db.prepare(`INSERT INTO messages (user_id,store_id,cast_id,direction,body,lang_original,body_ja,body_en,body_zh) VALUES (?,?,?,'user_to_store',?,?,?,?,?)`)
    .run(req.user.id, int(store_id), int(cast_id) || null, clean(body), lang,
      naiveTranslate(body, lang, 'ja'), naiveTranslate(body, lang, 'en'), naiveTranslate(body, lang, 'zh'));
  res.json({ ok: true });
});

/* ---------- ADMIN ---------- */
const TABLES = {
  areas:   ['slug','name_ja','name_en','name_zh','sort_order','status'],
  stores:  ['area_id','name_ja','name_en','name_zh','desc_ja','desc_en','desc_zh','logo','cover_image','images','hue','genre','address','google_map_url','open_hours','closed_days','phone','line_url','instagram','website','budget_min','budget_max','charge','service_fee','payment_methods','foreigner_welcome','english_ok','chinese_ok','credit_card_ok','reservation_ok','cast_count','is_recommended','sort_order','status'],
  casts:   ['store_id','name','display_name','photo','photos','hue','profile_ja','profile_en','profile_zh','height','hobbies','favorites','languages','english_ok','chinese_ok','recommend_ja','recommend_en','recommend_zh','sns_instagram','is_popular','sort_order','status','bust','birthplace','style_type','alcohol','skill','face','body_style','hair'],
  reviews: ['store_id','cast_id','author_name','rating','rating_service','rating_atmosphere','rating_price','rating_cast','rating_foreigner','title','body','visit_date','language','status'],
  events:  ['store_id','title_ja','title_en','title_zh','desc_ja','desc_en','desc_zh','event_date','start_time','end_time','image','hue','status'],
  coupons: ['store_id','title_ja','title_en','title_zh','desc_ja','desc_en','desc_zh','conditions_ja','conditions_en','conditions_zh','code','valid_until','image','hue','status'],
  blogs:   ['slug','category','title_ja','title_en','title_zh','body_ja','body_en','body_zh','seo_title','seo_description','image','hue','status'],
  users:   ['name','email','country','language','role','store_id','is_blocked'],
  messages:['user_id','store_id','cast_id','direction','body','lang_original','body_ja','body_en','body_zh','is_read','is_reported'],
  notifications:['store_id','user_id','template_ja','template_en','template_zh','channel','status'],
  settings:['key','value']
};

app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  const c = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  res.json({ stores: c('stores'), casts: c('casts'), users: c('users'), reviews: c('reviews'),
    pending_reviews: db.prepare(`SELECT COUNT(*) n FROM reviews WHERE status='pending'`).get().n,
    messages: c('messages'), events: c('events'), coupons: c('coupons'), blogs: c('blogs') });
});
app.get('/api/admin/:table', auth, adminOnly, (req, res) => {
  if (!TABLES[req.params.table]) return res.status(404).json({ error: 'unknown table' });
  let rows = db.prepare(`SELECT * FROM ${req.params.table} ORDER BY ${req.params.table === 'settings' ? 'key' : 'id DESC'} LIMIT 500`).all();
  const q = req.query.q;
  if (q) { const needle = String(q).toLowerCase(); rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(needle)); }
  res.json(rows);
});
app.post('/api/admin/:table', auth, adminOnly, (req, res) => {
  const cols = TABLES[req.params.table];
  if (!cols) return res.status(404).json({ error: 'unknown table' });
  const keys = cols.filter(k => req.body[k] !== undefined);
  if (!keys.length) return res.status(400).json({ error: 'no fields' });
  const r = db.prepare(`INSERT INTO ${req.params.table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map(k => typeof req.body[k] === 'number' ? req.body[k] : clean(req.body[k])));
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/admin/:table/:id', auth, adminOnly, (req, res) => {
  const cols = TABLES[req.params.table];
  if (!cols) return res.status(404).json({ error: 'unknown table' });
  const keys = cols.filter(k => req.body[k] !== undefined);
  if (!keys.length) return res.status(400).json({ error: 'no fields' });
  const keyCol = req.params.table === 'settings' ? 'key' : 'id';
  db.prepare(`UPDATE ${req.params.table} SET ${keys.map(k => k + '=?').join(',')} WHERE ${keyCol}=?`)
    .run(...keys.map(k => typeof req.body[k] === 'number' ? req.body[k] : clean(req.body[k])), req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/:table/:id', auth, adminOnly, (req, res) => {
  if (!TABLES[req.params.table]) return res.status(404).json({ error: 'unknown table' });
  const keyCol = req.params.table === 'settings' ? 'key' : 'id';
  db.prepare(`DELETE FROM ${req.params.table} WHERE ${keyCol}=?`).run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/messages/:id/reply', auth, adminOnly, (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(int(req.params.id));
  if (!m) return res.status(404).json({ error: 'not found' });
  const body = clean(req.body.body), lang = clean(req.body.lang || 'ja');
  db.prepare(`INSERT INTO messages (user_id,store_id,cast_id,direction,body,lang_original,body_ja,body_en,body_zh) VALUES (?,?,?,'store_to_user',?,?,?,?,?)`)
    .run(m.user_id, m.store_id, m.cast_id, body, lang,
      naiveTranslate(body, lang, 'ja'), naiveTranslate(body, lang, 'en'), naiveTranslate(body, lang, 'zh'));
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Tokyo Nightlife Guide running: http://localhost:${PORT}`));
