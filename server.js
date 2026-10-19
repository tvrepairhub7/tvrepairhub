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
app.get('/admin', auth, (req, res) => res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>TVREPAIRHUB Admin</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#f4f1ea;color:#14203a}header{background:#0e1b34;color:#e3b965;padding:16px 20px;font-size:20px;font-weight:700}main{padding:16px;overflow-x:auto}table{border-collapse:collapse;width:100%;background:#fff;min-width:760px}th,td{padding:10px;border-bottom:1px solid #e4dccb;text-align:left;font-size:14px;vertical-align:top}th{background:#faf6ec}a{color:#8a6218}</style></head>
<body><header>TVREPAIRHUB – Complaints</header><main><table><thead><tr><th>ID / Date</th><th>Customer</th><th>TV</th><th>Problem</th><th>Status</th><th>Action</th></tr></thead><tbody id="b"></tbody></table><p id="e"></p></main>
<script>
const S=['New','Contacted','In Progress','Completed','Cancelled'];
function td(t){const e=document.createElement('td');if(t)e.textContent=t;return e}
async function load(){const r=await fetch('/api/admin/complaints');const d=await r.json();const b=document.getElementById('b');b.innerHTML='';
document.getElementById('e').textContent=d.length?'':'No complaints yet.';
d.forEach(c=>{const tr=document.createElement('tr');
tr.append(td(c.id+'\\n'+new Date(c.createdAt).toLocaleString()));
const cu=td();cu.append(c.name+' ');cu.append(document.createElement('br'));const a=document.createElement('a');a.href='tel:'+c.phone;a.textContent=c.phone;cu.append(a);cu.append(document.createElement('br'));cu.append(c.address);tr.append(cu);
tr.append(td(c.brand+' ('+c.type+')'));tr.append(td(c.problem));
const st=td();const sel=document.createElement('select');S.forEach(x=>{const o=document.createElement('option');o.textContent=x;if(x===c.status)o.selected=true;sel.append(o)});
sel.onchange=()=>fetch('/api/admin/complaints/'+c.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:sel.value})});
st.append(sel);tr.append(st);const dt=td();const db=document.createElement('button');db.textContent='Delete';db.onclick=async()=>{if(confirm('Delete complaint '+c.id+'? This cannot be undone.')){await fetch('/api/admin/complaints/'+c.id,{method:'DELETE'});load()}};dt.append(db);tr.append(dt);b.append(tr)})}
load();
</script></body></html>`));

db.init()
  .then(() => app.listen(PORT, () => console.log(`TVREPAIRHUB running at http://localhost:${PORT} | storage: ${pool ? 'database (permanent)' : 'local file (NOT permanent on free hosting)'}`)))
  .catch(e => { console.error('Database error:', e.message); process.exit(1); });
