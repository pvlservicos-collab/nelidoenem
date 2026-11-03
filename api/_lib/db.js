import { neon } from '@neondatabase/serverless';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
export const sql = neon(url);

let ready;
export function ensureSchema() {
  if (!ready) {
    ready = (async () => {
      await sql`CREATE TABLE IF NOT EXISTS users (
        key text PRIMARY KEY,
        name text NOT NULL,
        points int NOT NULL DEFAULT 0,
        answered int NOT NULL DEFAULT 0,
        correct int NOT NULL DEFAULT 0,
        created_at bigint NOT NULL,
        updated_at bigint NOT NULL
      )`;
      await sql`CREATE TABLE IF NOT EXISTS answers (
        user_key text NOT NULL REFERENCES users(key) ON DELETE CASCADE,
        qid text NOT NULL,
        ok smallint NOT NULL,
        at bigint NOT NULL,
        PRIMARY KEY (user_key, qid)
      )`;
      await sql`CREATE TABLE IF NOT EXISTS explicacoes (
        qid text PRIMARY KEY,
        t text NOT NULL,
        at bigint NOT NULL,
        v int NOT NULL DEFAULT 1
      )`;
      await sql`CREATE INDEX IF NOT EXISTS users_points_idx ON users (points DESC)`;
    })().catch(e => { ready = null; throw e; });
  }
  return ready;
}

export const toUser = r => r && ({
  key: r.key, name: r.name, points: r.points, answered: r.answered, correct: r.correct,
  createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
});

// mesmas regras do front-end
export const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
export const keyOf = s => norm(s).replace(/[^a-z0-9 ]/g, '').trim().replace(/ /g, '-').slice(0, 60);
export const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 40);
export const validKey = k => typeof k === 'string' && /^[a-z0-9-]{1,60}$/.test(k);
export const validQid = q => typeof q === 'string' && /^[0-9a-z-]{3,40}$/i.test(q);

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

export function fail(res, e) {
  console.error(e);
  res.status(500).json({ error: 'erro_no_servidor' });
}
