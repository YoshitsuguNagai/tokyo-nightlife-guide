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
/* ---------- 翻訳 (DeepL優先・未設定時はキー不要のGoogle翻訳endpointにフォールバック) ---------- */
const TR_CACHE = new Map();
async function translateText(text, from, to) {
  text = String(text || '').slice(0, 4000);
  if (!text.trim() || from === to) return text;
  const ck = from + '|' + to + '|' + text;
  if (TR_CACHE.has(ck)) return TR_CACHE.get(ck);
  let out = null;
  try {
    const key = process.env.DEEPL_API_KEY;
    if (key) {
      const r = await fetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ auth_key: key, text, source_lang: from.toUpperCase(), target_lang: to === 'zh' ? 'ZH' : to.toUpperCase() })
      }).then(r => r.json());
      out = r.translations && r.translations[0] && r.translations[0].text;
    }
    if (!out) {
      const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=' + from + '&tl=' + (to === 'zh' ? 'zh-CN' : to) + '&q=' + encodeURIComponent(text);
      const r = await fetch(url).then(r => r.json());
      out = ((r && r[0]) || []).map(x => x[0]).join('');
    }
  } catch (e) { out = null; }
  if (!out) out = text; // ネットワーク不通時は原文を返す(壊れた[EN]表記は出さない)
  TR_CACHE.set(ck, out);
  return out;
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
function staffOnly(req, res, next) {
  if (!['admin','store','cast'].includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
  next();
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  next();
}
/* リソース所有権チェック: admin=全権限 / store=自店舗のみ / cast=自分のみ */
const owns = {
  stores:  (u,id)=> u.role==='admin' || (u.role==='store' && u.store_id===id),
  casts:   (u,id)=>{ if(u.role==='admin')return true; const c=db.prepare('SELECT store_id FROM casts WHERE id=?').get(id); if(!c)return false; return (u.role==='store'&&u.store_id===c.store_id)||(u.role==='cast'&&u.cast_id===id); },
  reviews: (u,id)=>{ if(u.role==='admin')return true; const r=db.prepare('SELECT store_id,cast_id FROM reviews WHERE id=?').get(id); if(!r)return false; if(u.role==='store')return r.store_id===u.store_id; if(u.role==='cast')return r.cast_id===u.cast_id; return false; },
  events:  (u,id)=>{ if(u.role==='admin')return true; const r=db.prepare('SELECT store_id FROM events WHERE id=?').get(id); return !!(r&&u.role==='store'&&u.store_id===r.store_id); },
  coupons: (u,id)=>{ if(u.role==='admin')return true; const r=db.prepare('SELECT store_id FROM coupons WHERE id=?').get(id); return !!(r&&u.role==='store'&&u.store_id===r.store_id); }
};
const convId = (uid, sid, cid) => cid ? `u${uid}-c${cid}` : `u${uid}-s${sid}`;

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
  if (String(b.body || '').trim().length < 200) return res.status(400).json({ error: 'min_200' });
  db.prepare(`INSERT INTO reviews (store_id,cast_id,user_id,author_name,rating,title,body,visit_date,language,status) VALUES (?,?,?,?,?,?,?,?,?,'pending')`)
    .run(int(b.store_id) || null, int(b.cast_id) || null, int(b.user_id) || null, clean(b.author_name || 'Guest'), Math.min(5, Math.max(1, int(b.rating) || 5)), clean(b.title), clean(b.body), clean(b.visit_date), clean(b.language || 'en'));
  res.json({ ok: true, message: 'pending_approval' });
});

/* 翻訳 */
app.post('/api/translate', async (req, res) => {
  const { text, from, to } = req.body;
  const translated = await translateText(clean(text), clean(from || 'ja'), clean(to || 'en'));
  res.json({ translated });
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
  res.json({ token: makeToken(u.id), user: { id: u.id, name: u.name, email: u.email, role: u.role, language: u.language, store_id: u.store_id, cast_id: u.cast_id } });
});
app.get('/api/me', auth, (req, res) => {
  const u = req.user;
  res.json({
    id: u.id, name: u.name, email: u.email, country: u.country, language: u.language, role: u.role, store_id: u.store_id, cast_id: u.cast_id,
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
app.post('/api/messages', auth, async (req, res) => {
  const { store_id, cast_id, body, kind, resv_date, resv_time, resv_people } = req.body;
  if (!store_id || !body) return res.status(400).json({ error: 'missing fields' });
  const lang = req.user.language || 'en';
  const mkind = clean(kind || (cast_id ? 'cast_chat' : 'store_chat'));
  db.prepare(`INSERT INTO messages (user_id,store_id,cast_id,direction,body,lang_original,body_ja,body_en,body_zh,kind,resv_date,resv_time,resv_people) VALUES (?,?,?,'user_to_store',?,?,?,?,?,?,?,?,?,?)`)
    .run(req.user.id, int(store_id), int(cast_id) || null, clean(body), lang, mkind, clean(resv_date||''), clean(resv_time||''), int(resv_people) || null,
      await translateText(body, lang, 'ja'), await translateText(body, lang, 'en'), await translateText(body, lang, 'zh'));
  const cid = convId(req.user.id, int(store_id), int(cast_id));
  db.prepare('UPDATE messages SET conversation_id=? WHERE id=last_insert_rowid()').run(cid);
  res.json({ ok: true });
});
/* 会話スレッド取得 (本人 or 権限者のみ) */
app.get('/api/messages/thread', auth, (req, res) => {
  const cid = clean(req.query.cid || '');
  const m = /^u(\d+)-([sc])(\d+)$/.exec(cid);
  if (!m) return res.status(400).json({ error: 'bad cid' });
  const uid = int(m[1]), sid = int(m[3]);
  const u = req.user;
  const allowed = u.role==='admin' || u.id===uid ||
    (m[2]==='s' && u.role==='store' && u.store_id===sid) ||
    (m[2]==='c' && u.role==='cast' && u.cast_id===sid);
  if (!allowed) return res.status(403).json({ error: 'forbidden' });
  const rows = db.prepare('SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at').all(cid);
  db.prepare(`UPDATE messages SET is_read=1 WHERE conversation_id=? AND direction='user_to_store'`).run(cid); // 店側が読んだ
  res.json(rows);
});
/* 口コミ公式返信 (店舗管理者/キャスト本人/Super Admin のみ) */
app.post('/api/reviews/:id/reply', auth, staffOnly, (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id=?').get(int(req.params.id));
  if (!r) return res.status(404).json({ error: 'not found' });
  const u = req.user; let role = null;
  if (u.role === 'admin') role = 'site';
  else if (u.role === 'store' && r.store_id === u.store_id) role = 'store';
  else if (u.role === 'cast' && r.cast_id === u.cast_id) role = 'cast';
  if (!role) return res.status(403).json({ error: 'forbidden' });
  let byName = clean(u.name);
  if (role === 'store') byName = (db.prepare('SELECT name_ja FROM stores WHERE id=?').get(r.store_id)||{}).name_ja || u.name;
  if (role === 'cast') byName = (db.prepare('SELECT display_name FROM casts WHERE id=?').get(r.cast_id)||{}).display_name || u.name;
  db.prepare(`UPDATE reviews SET reply_body=?, reply_by=?, reply_role=?, reply_at=datetime('now','+9 hours') WHERE id=?`)
    .run(clean(req.body.body), byName, role, r.id);
  res.json({ ok: true });
});

/* ---------- ADMIN ---------- */
const TABLES = {
  areas:   ['slug','name_ja','name_en','name_zh','sort_order','status'],
  stores:  ['area_id','name_ja','name_en','name_zh','desc_ja','desc_en','desc_zh','logo','cover_image','images','hue','genre','address','google_map_url','open_hours','closed_days','phone','line_url','instagram','website','budget_min','budget_max','charge','service_fee','payment_methods','foreigner_welcome','english_ok','chinese_ok','credit_card_ok','reservation_ok','cast_count','is_recommended','sort_order','status'],
  casts:   ['store_id','name','display_name','photo','photos','hue','profile_ja','profile_en','profile_zh','height','hobbies','favorites','languages','english_ok','chinese_ok','recommend_ja','recommend_en','recommend_zh','sns_instagram','is_popular','sort_order','status','bust','birthplace','style_type','alcohol','skill','face','body_style','hair'],
  reviews: ['store_id','cast_id','author_name','rating','rating_service','rating_atmosphere','rating_price','rating_cast','rating_foreigner','title','body','visit_date','language','status'],
  events:  ['store_id','title_ja','title_en','title_zh','desc_ja','desc_en','desc_zh','event_date','start_time','end_date','end_time','image','hue','status'],
  coupons: ['store_id','title_ja','title_en','title_zh','desc_ja','desc_en','desc_zh','conditions_ja','conditions_en','conditions_zh','code','valid_from','valid_until','image','hue','status'],
  blogs:   ['slug','category','title_ja','title_en','title_zh','body_ja','body_en','body_zh','seo_title','seo_description','image','hue','status'],
  users:   ['name','email','country','language','role','store_id','is_blocked'],
  messages:['user_id','store_id','cast_id','direction','body','lang_original','body_ja','body_en','body_zh','is_read','is_reported','kind','resv_date','resv_time','resv_people'],
  notifications:['store_id','user_id','template_ja','template_en','template_zh','channel','status'],
  settings:['key','value']
};

app.get('/api/admin/stats', auth, staffOnly, (req, res) => {
  const c = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  res.json({ stores: c('stores'), casts: c('casts'), users: c('users'), reviews: c('reviews'),
    pending_reviews: db.prepare(`SELECT COUNT(*) n FROM reviews WHERE status='pending'`).get().n,
    messages: c('messages'), events: c('events'), coupons: c('coupons'), blogs: c('blogs'),
    unread_msgs: req.user.role==='admin' ? db.prepare(`SELECT COUNT(*) n FROM messages WHERE is_read=0 AND direction='user_to_store'`).get().n
      : req.user.role==='store' ? db.prepare(`SELECT COUNT(*) n FROM messages WHERE is_read=0 AND direction='user_to_store' AND store_id=?`).get(req.user.store_id).n
      : db.prepare(`SELECT COUNT(*) n FROM messages WHERE is_read=0 AND direction='user_to_store' AND cast_id=?`).get(req.user.cast_id).n });
});
app.get('/api/admin/:table', auth, staffOnly, (req, res) => {
  const tbl = req.params.table;
  if (!TABLES[tbl]) return res.status(404).json({ error: 'unknown table' });
  if (tbl === 'settings' && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  if (tbl === 'users' && req.user.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  let rows = db.prepare(`SELECT * FROM ${tbl} ORDER BY ${tbl === 'settings' ? 'key' : 'id DESC'} LIMIT 500`).all();
  const u = req.user;
  if (u.role === 'store') {
    if (tbl === 'stores') rows = rows.filter(r => r.id === u.store_id);
    if (['casts','events','coupons','notifications'].includes(tbl)) rows = rows.filter(r => r.store_id === u.store_id);
    if (tbl === 'reviews') rows = rows.filter(r => r.store_id === u.store_id);
    if (tbl === 'messages') rows = rows.filter(r => r.store_id === u.store_id);
  } else if (u.role === 'cast') {
    if (tbl === 'casts') rows = rows.filter(r => r.id === u.cast_id);
    if (tbl === 'reviews') rows = rows.filter(r => r.cast_id === u.cast_id);
    if (tbl === 'messages') rows = rows.filter(r => r.cast_id === u.cast_id);
    if (['stores','events','coupons','blogs','areas','notifications'].includes(tbl)) return res.status(403).json({ error: 'forbidden' });
  }
  const q = req.query.q;
  if (q) { const needle = String(q).toLowerCase(); rows = rows.filter(r => JSON.stringify(r).toLowerCase().includes(needle)); }
  res.json(rows);
});
app.post('/api/admin/:table', auth, staffOnly, (req, res) => {
  const cols = TABLES[req.params.table];
  if (!cols) return res.status(404).json({ error: 'unknown table' });
  const tbl = req.params.table, u = req.user;
  if (tbl === 'users' && u.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  if (tbl === 'settings' && u.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  if (tbl === 'users') { // 初期パスワード設定 or 招待リンク発行
    const b = req.body;
    if (!b.email) return res.status(400).json({ error: 'email required' });
    try {
      const hasPw = b.password && String(b.password).length >= 8;
      const pw = hasPw ? String(b.password) : crypto.randomBytes(9).toString('hex');
      const r = db.prepare('INSERT INTO users (name,email,password_hash,country,language,role,store_id,cast_id) VALUES (?,?,?,?,?,?,?,?)')
        .run(clean(b.name), clean(b.email).toLowerCase(), hashPassword(pw), clean(b.country || ''), clean(b.language || 'ja'), clean(b.role || 'user'), int(b.store_id) || null, int(b.cast_id) || null);
      let invite = null;
      if (!hasPw) {
        const t = crypto.randomBytes(24).toString('hex');
        db.prepare('INSERT INTO password_resets (token,email,expires) VALUES (?,?,?)').run(t, clean(b.email).toLowerCase(), Date.now() + 7*24*3600*1000);
        invite = '/?reset=' + t;
      }
      return res.json({ id: r.lastInsertRowid, invite });
    } catch (e) { return res.status(400).json({ error: 'email already registered' }); }
  }
  if (u.role === 'cast' && tbl !== 'casts') return res.status(403).json({ error: 'forbidden' });
  if (u.role === 'store' && ['blogs','areas','users','settings'].includes(tbl)) return res.status(403).json({ error: 'forbidden' });
  if (u.role !== 'admin' && req.body.store_id && owns.stores && tbl !== 'stores') {
    if (u.role === 'store' && int(req.body.store_id) !== u.store_id) return res.status(403).json({ error: 'forbidden' });
  }
  if (u.role === 'cast') req.body.store_id = (db.prepare('SELECT store_id FROM casts WHERE id=?').get(u.cast_id)||{}).store_id;
  const keys = cols.filter(k => req.body[k] !== undefined);
  if (!keys.length) return res.status(400).json({ error: 'no fields' });
  const r = db.prepare(`INSERT INTO ${tbl} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map(k => typeof req.body[k] === 'number' ? req.body[k] : clean(req.body[k])));
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/admin/:table/:id', auth, staffOnly, (req, res) => {
  const cols = TABLES[req.params.table];
  if (!cols) return res.status(404).json({ error: 'unknown table' });
  const tbl = req.params.table, u = req.user, rid = req.params.id;
  if (tbl === 'users' && u.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  if (tbl === 'settings' && u.role !== 'admin') return res.status(403).json({ error: 'forbidden' });
  if (u.role !== 'admin' && owns[tbl] && !owns[tbl](u, int(rid))) return res.status(403).json({ error: 'forbidden' });
  if (u.role === 'cast' && tbl !== 'casts' && tbl !== 'reviews') return res.status(403).json({ error: 'forbidden' });
  if (u.role === 'store' && ['blogs','areas'].includes(tbl)) return res.status(403).json({ error: 'forbidden' });
  const keys = cols.filter(k => req.body[k] !== undefined);
  if (!keys.length) return res.status(400).json({ error: 'no fields' });
  const keyCol = tbl === 'settings' ? 'key' : 'id';
  db.prepare(`UPDATE ${req.params.table} SET ${keys.map(k => k + '=?').join(',')} WHERE ${keyCol}=?`)
    .run(...keys.map(k => typeof req.body[k] === 'number' ? req.body[k] : clean(req.body[k])), req.params.id);
  res.json({ ok: true });
});
app.delete('/api/admin/:table/:id', auth, staffOnly, (req, res) => {
  const tbl = req.params.table, u = req.user, rid = req.params.id;
  if (!TABLES[tbl]) return res.status(404).json({ error: 'unknown table' });
  if (u.role !== 'admin' && owns[tbl] && !owns[tbl](u, int(rid))) return res.status(403).json({ error: 'forbidden' });
  if (u.role === 'cast') return res.status(403).json({ error: 'forbidden' });
  if (u.role === 'store' && ['blogs','areas','users','settings','stores'].includes(tbl)) return res.status(403).json({ error: 'forbidden' });
  const keyCol = tbl === 'settings' ? 'key' : 'id';
  db.prepare(`DELETE FROM ${req.params.table} WHERE ${keyCol}=?`).run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/admin/messages/:id/reply', auth, staffOnly, async (req, res) => {
  const m = db.prepare('SELECT * FROM messages WHERE id=?').get(int(req.params.id));
  if (!m) return res.status(404).json({ error: 'not found' });
  const body = clean(req.body.body), lang = clean(req.body.lang || 'ja');
  db.prepare(`INSERT INTO messages (user_id,store_id,cast_id,direction,body,lang_original,body_ja,body_en,body_zh) VALUES (?,?,?,'store_to_user',?,?,?,?,?)`)
    .run(m.user_id, m.store_id, m.cast_id, body, lang,
      await translateText(body, lang, 'ja'), await translateText(body, lang, 'en'), await translateText(body, lang, 'zh'));
  res.json({ ok: true });
});

/* パスワードリセット (メール→再設定リンク→新PW) */
db.exec(`CREATE TABLE IF NOT EXISTS password_resets (token TEXT PRIMARY KEY, email TEXT, expires INTEGER, used INTEGER DEFAULT 0)`);
app.post('/api/auth/forgot', (req, res) => {
  const email = clean(req.body.email).toLowerCase();
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (!u) return res.json({ ok: true }); // 存在可否を外部に漏らさない
  const t = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO password_resets (token,email,expires) VALUES (?,?,?)').run(t, email, Date.now() + 24*3600*1000);
  // 本来はSMTPでメール送信。未設定の開発段階ではリンクを返す(README参照)
  res.json({ ok: true, link: '/?reset=' + t, note: 'smtp_not_configured' });
});
app.post('/api/auth/reset', (req, res) => {
  const t = clean(req.body.token), pw = String(req.body.password || '');
  if (pw.length < 8) return res.status(400).json({ error: 'password must be 8+ chars' });
  const r = db.prepare('SELECT * FROM password_resets WHERE token=? AND used=0').get(t);
  if (!r || r.expires < Date.now()) return res.status(400).json({ error: 'invalid or expired link' });
  db.prepare('UPDATE users SET password_hash=? WHERE email=?').run(hashPassword(pw), r.email);
  db.prepare('UPDATE password_resets SET used=1 WHERE token=?').run(t);
  res.json({ ok: true });
});
/* パスワード変更 (ログイン中のみ・平文保存なし) */
app.post('/api/auth/password', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!verifyPassword(String(req.body.current || ''), u.password_hash)) return res.status(400).json({ error: 'current password incorrect' });
  if (!req.body.next || String(req.body.next).length < 8) return res.status(400).json({ error: 'new password must be 8+ chars' });
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(String(req.body.next)), u.id);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Tokyo Nightlife Guide running: http://localhost:${PORT}`));
