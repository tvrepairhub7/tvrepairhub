const express = require('express'), fs = require('fs'), path = require('path');
const rateLimit = require('express-rate-limit');
let nodemailer = null; try { nodemailer = require('nodemailer'); } catch (e) {}

const app = express(); app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const ADMIN = process.env.ADMIN_PASSWORD || 'Ayyan@8417';
const ADMIN_USER = process.env.ADMIN_USER || 'tvrepairhub';
if (!process.env.ADMIN_PASSWORD) console.warn('Using default admin login. For the live site, set ADMIN_USER and ADMIN_PASSWORD as environment variables.');
const DB = path.join(__dirname, 'data', 'complaints.json');
fs.mkdirSync(path.dirname(DB), { recursive: true });
if (!fs.existsSync(DB)) fs.writeFileSync(DB, '[]');
const read = () => JSON.parse(fs.readFileSync(DB, 'utf8'));
const write = d => fs.writeFileSync(DB, JSON.stringify(d, null, 2));
const clean = (s, n) => String(s || '').replace(/[<>]/g, '').trim().slice(0, n);

const Pg = (() => { try { return require('pg'); } catch (e) { return null; } })();
const pool = process.env.DATABASE_URL && Pg ? new Pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }) : null;
const mk = r => ({ id: r.id, name: r.name, phone: r.phone, brand: r.brand, type: r.type, address: r.address, problem: r.problem, status: r.status, createdAt: new Date(r.created_at).toISOString() });
const db = pool ? {
  init: () => pool.query("CREATE TABLE IF NOT EXISTS complaints (id text PRIMARY KEY, name text, phone text, brand text, type text, address text, problem text, status text DEFAULT 'New', created_at timestamptz DEFAULT now())"),
  add: c => pool.query('INSERT INTO complaints (id,name,phone,brand,type,address,problem,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [c.id, c.name, c.phone, c.brand, c.type, c.address, c.problem, c.status, c.createdAt]),
  list: async () => (await pool.query('SELECT * FROM complaints ORDER BY created_at DESC')).rows.map(mk),
  find: async id => { const r = (await pool.query('SELECT * FROM complaints WHERE id=$1', [id])).rows[0]; return r ? mk(r) : null; },
  setStatus: async (id, s) => { const r = (await pool.query('UPDATE complaints SET status=$2 WHERE id=$1 RETURNING *', [id, s])).rows[0]; return r ? mk(r) : null; },
  remove: async id => (await pool.query('DELETE FROM complaints WHERE id=$1', [id])).rowCount > 0
} : {
  init: async () => {},
  add: async c => { const a = read(); a.unshift(c); write(a); },
  list: async () => read(),
  find: async id => read().find(x => x.id === id) || null,
  setStatus: async (id, s) => { const a = read(), c = a.find(x => x.id === id); if (!c) return null; c.status = s; write(a); return c; },
  remove: async id => { const a = read(), n = a.filter(x => x.id !== id); if (n.length === a.length) return false; write(n); return true; }
};
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

async function notify(c) {
  if (!nodemailer || !process.env.SMTP_USER) return;
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT || 465),
    secure: +(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await t.sendMail({
    from: process.env.SMTP_USER,
    to: process.env.NOTIFY_EMAIL || 'tvrepairhub7@gmail.com',
    subject: `New TV complaint ${c.id} - ${c.brand}`,
    text: `ID: ${c.id}\nName: ${c.name}\nPhone: ${c.phone}\nBrand: ${c.brand}\nType: ${c.type}\nAddress: ${c.address}\nProblem: ${c.problem}`
  });
}

app.post('/api/complaints', rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }), async (req, res) => {
  const b = req.body || {};
  const phone = String(b.phone || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const c = {
    id: 'TRH-' + Date.now().toString(36).toUpperCase(),
    name: clean(b.name, 80), phone, brand: clean(b.brand, 40), type: clean(b.type, 40),
    address: clean(b.address, 200), problem: clean(b.problem, 800),
    status: 'New', createdAt: new Date().toISOString()
  };
  if (c.name.length < 2) return res.status(400).json({ error: 'Please enter your name' });
  if (!/^[6-9]\d{9}$/.test(c.phone)) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
  if (c.address.length < 3 || c.problem.length < 5) return res.status(400).json({ error: 'Please fill address and problem' });
  try { await db.add(c); } catch (e) { console.error(e); return res.status(500).json({ error: 'Could not save your complaint. Please call us' }); }
  notify(c).catch(e => console.error('Email failed:', e.message));
  res.json({ ok: true, id: c.id });
});

const CAT = require('./catalog.json');
app.get('/api/catalog', (q, r) => r.json(CAT));
app.get('/api/complaints/:id', rateLimit({ windowMs: 15 * 60 * 1000, max: 30 }), async (q, r) => {
  const p = String(q.query.phone || '').replace(/\D/g, '').slice(-10);
  const c = await db.find(q.params.id.trim().toUpperCase()).catch(() => null);
  if (!c || c.phone !== p) return r.status(404).json({ error: 'No complaint found for this ID and phone number' });
  r.json({ id: c.id, status: c.status, brand: c.brand, type: c.type, createdAt: c.createdAt });
});
app.get('/robots.txt', (q, r) => r.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${q.protocol}://${q.get('host')}/sitemap.xml`));
app.get('/sitemap.xml', (q, r) => {
  const b = `${q.protocol}://${q.get('host')}/`;
  const u = ['', 'services.html', 'brands.html', 'about.html', 'contact.html', 'track.html', ...CAT.services.map(s => 'service.html?s=' + s.slug), ...CAT.brands.map(x => 'brand.html?b=' + encodeURIComponent(x))];
  r.type('application/xml').send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + u.map(x => `<url><loc>${b}${x.replace(/&/g, '&amp;')}</loc></url>`).join('') + '</urlset>');
});

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const dec = Buffer.from(h.split(' ')[1] || '', 'base64').toString(), i = dec.indexOf(':');
  if (i > -1 && dec.slice(0, i) === ADMIN_USER && dec.slice(i + 1) === ADMIN) return next();
  res.set('WWW-Authenticate', 'Basic realm="TVREPAIRHUB Admin"').status(401).send('Login required');
}
app.get('/api/admin/complaints', auth, async (req, res) => { try { res.json(await db.list()); } catch (e) { console.error(e); res.status(500).json({ error: 'Database error' }); } });
app.patch('/api/admin/complaints/:id', auth, express.json(), async (req, res) => {
  try {
    if (!['New', 'Contacted', 'In Progress', 'Completed', 'Cancelled'].includes(req.body.status)) return res.status(400).json({ error: 'Bad status' });
    const c = await db.setStatus(req.params.id, req.body.status);
    if (!c) return res.status(404).json({ error: 'Not found' });
    res.json(c);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Database error' }); }
});
app.delete('/api/admin/complaints/:id', auth, async (req, res) => {
  try {
    if (!(await db.remove(req.params.id))) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Database error' }); }
});
app.get('/api/admin/export.csv', auth, async (req, res) => {
  try {
    const rows = await db.list();
    const esc = v => { let t = String(v == null ? '' : v); if (/^[=+\-@]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const lines = [['ID', 'Date', 'Name', 'Phone', 'Brand', 'Type', 'Address', 'Problem', 'Status'].map(esc).join(',')]
      .concat(rows.map(c => [c.id, c.createdAt, c.name, c.phone, c.brand, c.type, c.address, c.problem, c.status].map(esc).join(',')));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="tvrepairhub-complaints.csv"' }).send('\ufeff' + lines.join('\r\n'));
  } catch (e) { console.error(e); res.status(500).send('Database error'); }
});
app.get('/admin', auth, (q, r) => r.sendFile(path.join(__dirname, 'views', 'admin.html')));

db.init()
  .then(() => app.listen(PORT, () => console.log(`TVREPAIRHUB running at http://localhost:${PORT} | storage: ${pool ? 'database (permanent)' : 'local file (NOT permanent on free hosting)'}`)))
  .catch(e => { console.error('Database error:', e.message); process.exit(1); });
