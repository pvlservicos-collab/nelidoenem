import { sql, ensureSchema, toUser, validKey, validQid, readBody, fail } from './_lib/db.js';

// POST /api/answer {key, qid, ok} -> {counted, user}
// Só a primeira resposta de cada questão conta.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  try {
    await ensureSchema();
    const { key, qid, ok } = await readBody(req);
    if (!validKey(key) || !validQid(qid)) return res.status(400).json({ error: 'dados_invalidos' });
    const now = Date.now();
    const ins = await sql`INSERT INTO answers (user_key, qid, ok, at)
                          SELECT ${key}, ${qid}, ${ok ? 1 : 0}, ${now} WHERE EXISTS (SELECT 1 FROM users WHERE key = ${key})
                          ON CONFLICT DO NOTHING RETURNING qid`;
    const [u] = await sql`UPDATE users SET
        answered = s.answered, correct = s.correct, points = s.correct, updated_at = ${now}
      FROM (SELECT count(*)::int AS answered, count(*) FILTER (WHERE ok = 1)::int AS correct
            FROM answers WHERE user_key = ${key}) s
      WHERE users.key = ${key} RETURNING users.*`;
    if (!u) return res.status(404).json({ error: 'usuario_nao_encontrado' });
    res.status(200).json({ counted: ins.length > 0, user: toUser(u) });
  } catch (e) { fail(res, e); }
}
