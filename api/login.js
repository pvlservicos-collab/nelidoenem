import { sql, ensureSchema, toUser, keyOf, cleanName, readBody, fail } from './_lib/db.js';

// POST /api/login {name} -> {user, answers}
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    await ensureSchema();
    const { name: raw } = await readBody(req);
    const name = cleanName(raw), key = keyOf(name);
    if (!key) return res.status(400).json({ error: 'Digite um nome com pelo menos uma letra.' });
    const now = Date.now();
    await sql`INSERT INTO users (key, name, created_at, updated_at) VALUES (${key}, ${name}, ${now}, ${now})
              ON CONFLICT (key) DO NOTHING`;
    const [u] = await sql`SELECT * FROM users WHERE key = ${key}`;
    const rows = await sql`SELECT qid, ok FROM answers WHERE user_key = ${key}`;
    const answers = Object.fromEntries(rows.map(r => [r.qid, r.ok]));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ user: toUser(u), answers });
  } catch (e) { fail(res, e); }
}
