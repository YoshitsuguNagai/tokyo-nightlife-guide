/**
 * 公式サイト インポート機能 (Super Admin専用)
 * 方針: 自動取得は「下書き」まで。公開は必ずTNG管理者が行う。
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function decodeEnt(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)));
}
function stripScripts(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
}
function toLines(html) {
  return stripScripts(html)
    .replace(/<\/(p|div|li|tr|section|h[1-6]|br|td|th)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .split('\n').map(l => decodeEnt(l).replace(/\s+/g, ' ').trim()).filter(Boolean);
}
function absUrl(base, href) {
  if (!href) return null;
  try { const u = new URL(href, base); if (!/^https?:$/.test(u.protocol)) return null; return u.href; } catch (e) { return null; }
}
function badHost(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    if (['localhost', '127.0.0.1', '::1', '0.0.0.0'].includes(h)) return true;
    if (/^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
    return false;
  } catch (e) { return true; }
}
async function fetchPage(url) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (badHost(url)) throw new Error('invalid url');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: ctrl.signal });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const ct = r.headers.get('content-type') || '';
    const html = await r.text();
    if (html.length > 4 * 1024 * 1024) throw new Error('page too large');
    return { finalUrl: r.url || url, html, contentType: ct };
  } finally { clearTimeout(timer); }
}
function meta(html, prop) {
  let m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]+content=["\']([^"\']+)["\']', 'i'));
  if (!m) m = html.match(new RegExp('<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']' + prop + '["\']', 'i'));
  return m ? decodeEnt(m[1]).trim() : null;
}
function jsonLd(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m; while ((m = re.exec(html))) { try { const j = JSON.parse(m[1]); (Array.isArray(j) ? j : [j]).forEach(x => out.push(x)); } catch (e) {} }
  return out;
}
function fld(value, status) { return { value: value === undefined || value === null ? '' : String(value), status: status || (value ? 'ok' : 'none') }; }

const AREA_KEYS = [['roppongi', /六本木|roppongi/i], ['shinjuku', /新宿|歌舞伎町|shinjuku|kabukicho/i], ['ginza', /銀座|ginza/i], ['shibuya', /渋谷|shibuya/i], ['ueno', /上野|ueno/i], ['ikebukuro', /池袋|ikebukuro/i]];

function extractStore(html, finalUrl, areas) {
  const lines = toLines(html);
  const text = lines.join(' ');
  const lds = jsonLd(html);
  const ld = lds.find(x => /LocalBusiness|Store|Organization|BarOrPub|NightClub|FoodEstablishment/i.test(String(x['@type'] || ''))) || lds[0] || {};
  const F = {};
  // 店舗名
  let name = (ld && ld.name) || meta(html, 'og:title') || '';
  if (!name) { const t = html.match(/<title[^>]*>([^<]+)<\/title>/i); name = t ? t[1] : ''; }
  name = decodeEnt(name).split(/[|｜【\-–—]/)[0].trim();
  F.name_ja = fld(name, name ? 'check' : 'none');
  // 説明
  const desc = (ld && ld.description) || meta(html, 'og:description') || meta(html, 'description') || '';
  F.desc_ja = fld(desc.slice(0, 500), desc ? 'check' : 'none');
  // 電話
  let tel = (ld && ld.telephone) || '';
  if (!tel) { const m = html.match(/tel:0(\d[\d\-]{8,12})/i); if (m) tel = '0' + m[1]; }
  if (!tel) { const m = text.match(/0\d{1,4}[-‐–]\d{1,4}[-‐–]\d{4}/); if (m) tel = m[0]; }
  F.phone = fld(tel, tel ? 'ok' : 'none');
  // 住所
  let addr = '';
  if (ld && ld.address) { const a = ld.address; addr = [a.addressRegion, a.addressLocality, a.streetAddress].filter(Boolean).join(''); }
  if (!addr) { const ln = lines.find(l => /〒?\d{3}[-‐]?\d{4}/.test(l) && /(都|道|府|県)/.test(l)); if (ln) addr = ln.replace(/〒?\d{3}[-‐]?\d{4}\s*/, '').slice(0, 60); }
  if (!addr) { const m = text.match(/東京都[^\s]{3,40}/); if (m) addr = m[0]; }
  F.address = fld(addr, addr ? 'check' : 'none');
  // 営業時間
  let hours = '';
  if (ld && ld.openingHours) hours = Array.isArray(ld.openingHours) ? ld.openingHours.join(' ') : String(ld.openingHours);
  const hLine = lines.find(l => /営業時間|OPEN|営業|TIME/i.test(l) && /\d{1,2}:\d{2}/.test(l)) || '';
  const hM = (hLine || text).match(/(\d{1,2}:\d{2})\s*[〜～~\-–—]\s*(翌\s*)?(\d{1,2}:\d{2})/);
  if (hM) hours = hM[1] + '〜' + (hM[2] ? '翌' : '') + hM[3];
  F.open_hours = fld(hours, hours ? (hM ? 'ok' : 'check') : 'none');
  // 定休日
  let hol = '';
  const cLine = lines.find(l => /定休|休み|休業|CLOSED/i.test(l));
  if (cLine) { const m = cLine.match(/(?:定休日?|休み|休業日?|CLOSED)\s*[：:]?\s*([^\s。]{1,30})/i); if (m) hol = m[1].replace(/[。．,，].*$/, ''); }
  F.closed_days = fld(hol, hol ? 'check' : 'none');
  // SNS / サイト
  const hrefs = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map(m => m[1]);
  const find = re => { const h = hrefs.find(h => re.test(h)); return h ? absUrl(finalUrl, h) : null; };
  const ig = find(/instagram\.com/i), line = find(/line\.me|lin\.ee/i);
  const x = find(/(?:^|\.)x\.com|twitter\.com/i), tk = find(/tiktok\.com/i);
  const gmap = find(/maps\.app\.goo\.gl|google\.[a-z.]+\/maps/i) || (html.match(/<iframe[^>]+src=["']([^"']*google[^"']*maps[^"']*)["']/i) || [])[1] || null;
  F.instagram = fld(ig || '', ig ? 'ok' : 'none');
  F.line_url = fld(line || '', line ? 'ok' : 'none');
  F.sns_x = fld(x || '', x ? 'ok' : 'none');
  F.sns_tiktok = fld(tk || '', tk ? 'ok' : 'none');
  F.google_map_url = fld(gmap || '', gmap ? 'ok' : 'none');
  F.website = fld(finalUrl, 'ok');
  // 言語
  F.english_ok = fld(/英語|English/i.test(text) ? 1 : 0, /英語|English/i.test(text) ? 'check' : 'none');
  F.chinese_ok = fld(/中国語|中文|Chinese/i.test(text) ? 1 : 0, /中国語|中文|Chinese/i.test(text) ? 'check' : 'none');
  // 予算
  const nums = (text.match(/\d{1,3}(?:,\d{3})+\s*円|\d{4,6}\s*円/g) || []).map(s => parseInt(s.replace(/[^\d]/g, ''), 10)).filter(n => n >= 1000 && n <= 300000);
  if (nums.length) { F.budget_min = fld(Math.min(...nums), 'check'); F.budget_max = fld(Math.max(...nums), 'check'); }
  else { F.budget_min = fld('', 'none'); F.budget_max = fld('', 'none'); }
  // 料金補足
  const chLine = lines.find(l => /チャージ|CHARGE/i.test(l)); F.charge = fld(chLine ? chLine.slice(0, 60) : '', chLine ? 'check' : 'none');
  const svLine = lines.find(l => /サービス料|TAX|tax/i.test(l)); F.service_fee = fld(svLine ? svLine.slice(0, 60) : '', svLine ? 'check' : 'none');
  F.payment_methods = fld(/VISA|Mastercard|JCB|AMEX|カード/i.test(text) ? '現金, クレジットカード' : '', /カード/i.test(text) ? 'check' : 'none');
  // ジャンル推測
  const genre = /ラウンジ/i.test(text) ? 'lounge' : (/ガールズバー/i.test(text) ? 'lounge' : (/クラブ/i.test(name) && !/キャバ/i.test(text) ? 'club' : 'cabaret'));
  F.genre = fld(genre, 'check');
  // エリア推測
  let areaId = '', areaStatus = 'none';
  for (const [slug, re] of AREA_KEYS) {
    if (re.test(name + ' ' + addr) || re.test(text.slice(0, 3000))) {
      const a = (areas || []).find(x => x.slug === slug);
      if (a) { areaId = a.id; areaStatus = re.test(name + ' ' + addr) ? 'ok' : 'check'; }
      break;
    }
  }
  F.area_id = fld(areaId, areaStatus);
  // 画像
  const imgTags = [...html.matchAll(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi)].map(m => ({ src: m[1], tag: m[0] }));
  const seen = new Set(); const images = []; const logos = [];
  const ogimg = meta(html, 'og:image'); if (ogimg) { const u = absUrl(finalUrl, ogimg); if (u && !seen.has(u)) { seen.add(u); images.push(u); } }
  for (const im of imgTags) {
    const u = absUrl(finalUrl, im.src);
    if (!u || seen.has(u)) continue;
    if (/\.(svg|ico)(\?|$)/i.test(u)) continue;
    if (/favicon|icon-|apple-touch|spacer|blank|loading|dummy/i.test(u)) continue;
    seen.add(u);
    if (/logo/i.test(u) || /logo/i.test(im.tag)) { logos.push(u); continue; }
    if (/sns|line\.png|insta|twitter|facebook|btn|button|arrow|nav/i.test(u)) continue;
    images.push(u);
    if (images.length >= 24) break;
  }
  return { fields: F, images, logo: logos.slice(0, 4) };
}

function extractCastList(html, baseUrl) {
  const out = []; const seen = new Set();
  const re = /<a[^>]+href=["']([^"']*\/cast\/(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html))) {
    const id = m[2]; if (seen.has(id)) continue; seen.add(id);
    const url = absUrl(baseUrl, m[1]);
    const inner = m[3];
    let name = decodeEnt(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const alt = inner.match(/alt=["']([^"']+)["']/i);
    if ((!name || name.length > 25) && alt) name = decodeEnt(alt[1]).trim();
    name = name.replace(/(NEW|新人|詳細|more|›|»).*/i, '').replace(/[（(][^（）()]*[）)]/g, '').trim().slice(0, 20);
    const img = inner.match(/<img[^>]+src=["']([^"']+)["']/i);
    const thumb = img ? absUrl(baseUrl, img[1]) : null;
    if (url) out.push({ id, name, url, thumb });
  }
  return out;
}

function extractCastDetail(html, baseUrl) {
  const lines = toLines(html);
  const F = {}; const unmapped = [];
  let name = meta(html, 'og:title') || '';
  if (!name) { const t = html.match(/<title[^>]*>([^<]+)<\/title>/i); name = t ? t[1] : ''; }
  name = decodeEnt(name).split(/[|｜【\-–—]/)[0].replace(/キャスト|プロフィール|CAST/gi, '').trim().slice(0, 20);
  F.name = fld(name, name ? 'check' : 'none');
  // th/dt ラベル構造
  const pairs = [];
  [...html.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].forEach(m => pairs.push([m[1], m[2]]));
  [...html.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/gi)].forEach(m => pairs.push([m[1], m[2]]));
  [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].forEach(m => { const s = m[1]; if (/[：:]/.test(decodeEnt(s.replace(/<[^>]+>/g, '')))) { const p = s.split(/[：:]/); if (p.length >= 2) pairs.push([p[0], p.slice(1).join(':')]); } });
  const cleanV = v => decodeEnt(String(v).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  for (const [k, v] of pairs) {
    const key = cleanV(k), val = cleanV(v);
    if (!key || !val || key.length > 12 || val.length > 120) continue;
    if (/身長|HEIGHT/i.test(key)) { const n = val.match(/\d{2,3}/); if (n) F.height = fld(parseInt(n[0], 10), 'ok'); }
    else if (/バスト|BUST/i.test(key)) { F.bust = fld(val, 'check'); }
    else if (/出身|BIRTH/i.test(key)) { F.birthplace = fld(val, 'check'); }
    else if (/誕生日|生年月日|BIRTHDAY/i.test(key)) { unmapped.push('誕生日: ' + val); }
    else if (/血液|型/i.test(key)) { unmapped.push(key + ': ' + val); }
    else if (/趣味|好き|HOBBY/i.test(key)) { F.hobbies = fld(val, 'check'); }
    else unmapped.push(key + ': ' + val);
  }
  if (!F.height) { const m = (lines.find(l => /身長/.test(l)) || '').match(/(\d{2,3})/); if (m) F.height = fld(parseInt(m[1], 10), 'check'); else F.height = fld('', 'none'); }
  if (!F.bust) F.bust = fld('', 'none');
  if (!F.birthplace) F.birthplace = fld('', 'none');
  if (!F.hobbies) F.hobbies = fld('', 'none');
  // プロフィール文
  const long = lines.filter(l => l.length >= 40 && l.length <= 400 && !/Copyright|©|All Rights|営業時間|アクセス|メニュー/i.test(l));
  F.profile_ja = fld(long[0] || '', long[0] ? 'check' : 'none');
  // SNS
  const hrefs = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map(m => m[1]);
  const find = re => { const h = hrefs.find(h => re.test(h)); return h ? absUrl(baseUrl, h) : null; };
  const ig = find(/instagram\.com/i), x = find(/(?:^|\.|\/\/)x\.com|twitter\.com/i), tk = find(/tiktok\.com/i);
  F.sns_instagram = fld(ig || '', ig ? 'ok' : 'none');
  F.sns_x = fld(x || '', x ? 'ok' : 'none');
  F.sns_tiktok = fld(tk || '', tk ? 'ok' : 'none');
  // 写真
  const seen = new Set(); const photos = [];
  for (const m of html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    const u = absUrl(baseUrl, m[1]);
    if (!u || seen.has(u)) continue;
    if (/\.(svg|ico)(\?|$)/i.test(u)) continue;
    if (/logo|icon|favicon|banner|btn|button|arrow|sns|line\.|insta|twitter|spacer|blank|loading|dummy|header|footer|bg[_\.]/i.test(u)) continue;
    seen.add(u); photos.push(u);
    if (photos.length >= 8) break;
  }
  return { fields: F, photos, unmapped: unmapped.slice(0, 12) };
}

module.exports = function setupImport(app, ctx) {
  const { db, auth, adminOnly, UPLOAD_DIR } = ctx;

  app.post('/api/admin/import/fetch', auth, adminOnly, async (req, res) => {
    try {
      const { url } = req.body || {};
      if (!url) return res.status(400).json({ error: 'URLを入力してください' });
      const { finalUrl, html } = await fetchPage(url);
      const areas = db.prepare('SELECT id,slug,name_ja FROM areas').all();
      const store = extractStore(html, finalUrl, areas);
      // キャスト一覧ページ探索
      let castPageUrl = null, casts = [];
      const hrefs = [...html.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)].map(m => absUrl(finalUrl, m[1])).filter(Boolean);
      castPageUrl = hrefs.find(u => /\/cast\/?$/.test(new URL(u).pathname)) || hrefs.find(u => /\/cast\//.test(new URL(u).pathname));
      if (castPageUrl) {
        try {
          const cp = await fetchPage(castPageUrl.replace(/\/cast\/\d+.*$/, '/cast'));
          castPageUrl = cp.finalUrl;
          casts = extractCastList(cp.html, cp.finalUrl).slice(0, 300);
        } catch (e) { casts = []; }
      }
      // 既存データとの差分
      let existing = null;
      const host = new URL(finalUrl).hostname.replace(/^www\./, '');
      const stores = db.prepare('SELECT * FROM stores').all();
      const match = stores.find(s => s.website && s.website.includes(host)) ||
        stores.find(s => s.name_ja && store.fields.name_ja.value && (s.name_ja.includes(store.fields.name_ja.value) || store.fields.name_ja.value.includes(s.name_ja)));
      if (match) {
        const diffs = [];
        ['open_hours', 'closed_days', 'address', 'phone', 'instagram'].forEach(k => {
          const nv = store.fields[k] ? store.fields[k].value : '';
          if (nv && String(match[k] || '') !== String(nv)) diffs.push({ field: k, old: match[k] || '', next: nv });
        });
        const existCasts = db.prepare('SELECT id,name FROM casts WHERE store_id=?').all(match.id);
        const fetchedNames = new Set(casts.map(c => c.name).filter(Boolean));
        const existNames = new Set(existCasts.map(c => c.name));
        casts.forEach(c => { c.exist = c.name && existNames.has(c.name) ? 'existing' : 'new'; });
        const missing = existCasts.filter(c => !fetchedNames.has(c.name));
        existing = { store_id: match.id, name_ja: match.name_ja, diffs, missing_casts: missing };
      } else {
        casts.forEach(c => { c.exist = 'new'; });
      }
      res.json({ ok: true, url: finalUrl, store, castPageUrl, casts, existing });
    } catch (e) {
      res.status(502).json({ error: '取得に失敗しました: ' + (e.message || 'fetch error') });
    }
  });

  app.post('/api/admin/import/cast', auth, adminOnly, async (req, res) => {
    try {
      const { url } = req.body || {};
      if (!url) return res.status(400).json({ error: 'URL required' });
      const { finalUrl, html } = await fetchPage(url);
      const r = extractCastDetail(html, finalUrl);
      res.json({ ok: true, url: finalUrl, ...r });
    } catch (e) {
      res.status(502).json({ error: 'cast fetch failed: ' + (e.message || '') });
    }
  });

  /* 画像の再保存 (直リンク防止)。Cloudinary設定があればそちらへ。 */
  app.post('/api/admin/import/rehost', auth, adminOnly, async (req, res) => {
    try {
      const urls = Array.isArray(req.body && req.body.urls) ? req.body.urls.slice(0, 10) : [];
      const cloud = process.env.CLOUDINARY_CLOUD_NAME, preset = process.env.CLOUDINARY_UPLOAD_PRESET;
      const out = [];
      for (const u of urls) {
        try {
          if (badHost(u)) throw new Error('bad url');
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 20000);
          const r = await fetch(u, { headers: { 'User-Agent': UA, 'Referer': new URL(u).origin + '/' }, signal: ctrl.signal });
          clearTimeout(timer);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const ct = (r.headers.get('content-type') || '').split(';')[0];
          if (!/^image\/(png|jpe?g|webp|gif)$/.test(ct)) throw new Error('not image');
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length > 8 * 1024 * 1024) throw new Error('too large');
          if (cloud && preset) {
            const fd = new FormData();
            fd.append('file', new Blob([buf], { type: ct }), 'import.' + (ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg'));
            fd.append('upload_preset', preset);
            const up = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: fd }).then(r => r.json());
            if (!up.secure_url) throw new Error(up.error && up.error.message || 'cloudinary failed');
            out.push({ src: u, url: up.secure_url, storage: 'cloudinary' });
          } else {
            const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : ct.includes('gif') ? 'gif' : 'jpg';
            const name = Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.' + ext;
            fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
            out.push({ src: u, url: '/uploads/' + name, storage: 'local', warning: 'ローカル保存(再デプロイで消えます)' });
          }
        } catch (e) { out.push({ src: u, error: e.message || 'failed' }); }
      }
      res.json({ ok: true, results: out });
    } catch (e) { res.status(500).json({ error: 'rehost failed' }); }
  });
};
