'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { ADMIN_PASSWORD, SESSION_SECRET } = process.env;
const FACTORY_NAME = process.env.FACTORY_NAME || 'Factory Portal';
const PORT = Number(process.env.PORT) || 3000;
const DATA_FILE = path.join(process.env.DATA_DIR || '/data', 'apps.json');
const SESSION_HOURS = 8;

if (!ADMIN_PASSWORD || !SESSION_SECRET) {
  console.error('Missing ADMIN_PASSWORD or SESSION_SECRET. Copy .env.example to .env and fill both.');
  process.exit(1);
}

// ---------- storage (JSON file, atomic writes) ----------
const SEED = [
  { id: 'seed-1', name: 'Intranet', url: 'http://192.168.1.10', category: 'Company', description: 'News, notices and documents' },
  { id: 'seed-2', name: 'Clinic', url: 'http://192.168.1.20', category: 'Health', description: 'Clinic records and appointments' },
];
function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { save(SEED); return SEED.slice(); }
}
function save(list) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- auth (signed cookie, no extra dependencies) ----------
const sign = (v) => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('hex');
const safeEq = (a, b) => {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
};
function makeToken() {
  const exp = String(Date.now() + SESSION_HOURS * 3600 * 1000);
  return `${exp}.${sign(exp)}`;
}
function isAdmin(req) {
  const m = /(?:^|;\s*)admin=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, sig] = m[1].split('.');
  return !!exp && !!sig && safeEq(sig, sign(exp)) && Number(exp) > Date.now();
}
const requireAdmin = (req, res, next) =>
  isAdmin(req) ? next() : res.status(401).json({ error: 'Admin login required' });

// login lockout: 5 wrong tries per IP -> 5 minute wait
const fails = new Map();
function locked(ip) { const f = fails.get(ip); return f && f.n >= 5 && f.until > Date.now(); }

// ---------- validation ----------
function clean(body) {
  const s = (v, max) => String(v || '').trim().slice(0, max);
  const app = { name: s(body.name, 60), url: s(body.url, 300), category: s(body.category, 40) || 'General', description: s(body.description, 120) };
  if (!app.name) return { error: 'Name is required' };
  if (!/^https?:\/\/[^\s]+$/i.test(app.url)) return { error: 'Address must start with http:// or https://' };
  return { app };
}

// ---------- app ----------
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
  if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/session', (req, res) => res.json({ admin: isAdmin(req), factory: FACTORY_NAME }));
app.get('/api/apps', (req, res) => res.json({ apps: load() }));

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (locked(ip)) return res.status(429).json({ error: 'Too many wrong attempts. Try again in 5 minutes.' });
  if (!safeEq(req.body.password || '', ADMIN_PASSWORD)) {
    const f = fails.get(ip) || { n: 0, until: 0 };
    f.n += 1; f.until = Date.now() + 5 * 60 * 1000; fails.set(ip, f);
    return res.status(401).json({ error: 'Wrong password' });
  }
  fails.delete(ip);
  res.set('Set-Cookie', `admin=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}`);
  res.json({ admin: true });
});
app.post('/api/logout', (req, res) => {
  res.set('Set-Cookie', 'admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ admin: false });
});

app.post('/api/apps', requireAdmin, (req, res) => {
  const { app: a, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const list = load();
  a.id = crypto.randomUUID();
  list.push(a); save(list);
  res.status(201).json(a);
});
app.put('/api/apps/:id', requireAdmin, (req, res) => {
  const { app: a, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const list = load();
  const i = list.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'App not found' });
  list[i] = { ...a, id: req.params.id }; save(list);
  res.json(list[i]);
});
app.delete('/api/apps/:id', requireAdmin, (req, res) => {
  const list = load();
  const next = list.filter((x) => x.id !== req.params.id);
  if (next.length === list.length) return res.status(404).json({ error: 'App not found' });
  save(next);
  res.json({ ok: true });
});

app.get('/healthz', (req, res) => res.send('ok'));
app.listen(PORT, () => console.log(`${FACTORY_NAME} portal listening on :${PORT}`));
