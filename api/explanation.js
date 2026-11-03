import { sql, ensureSchema, validQid, fail } from './_lib/db.js';

// GET /api/explanation?qid=2023-1-es -> {t, at, v} | 404
export default async function handler(req, res) {
  try {
    await ensureSchema();
    const qid = req.query?.qid;
    if (!validQid(qid)) return res.status(400).json({ error: 'qid' });
    const [r] = await sql`SELECT t, at, v FROM explicacoes WHERE qid = ${qid}`;
    if (!r) return res.status(404).json({ error: 'nao_encontrada' });
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    res.status(200).json({ t: r.t, at: Number(r.at), v: r.v });
  } catch (e) { fail(res, e); }
}
