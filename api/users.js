import { sql, ensureSchema, toUser, fail } from './_lib/db.js';

// GET /api/users -> ranking (top 1000)
export default async function handler(req, res) {
  try {
    await ensureSchema();
    const rows = await sql`SELECT * FROM users ORDER BY points DESC, updated_at ASC LIMIT 1000`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ users: rows.map(toUser) });
  } catch (e) { fail(res, e); }
}
