// Importa explicações já escritas (arquivos JSON {id: texto}) para a tabela "explicacoes" do Neon.
// Uso: node --env-file=.env.local scripts/importar-explicacoes.mjs <pasta-com-jsons>
// Só grava textos válidos (com [RESUMO] e [PASSOS]) de questões que existem; mostra o que ficou faltando.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, ensureSchema } from '../api/_lib/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
if (!dir) { console.error('Passe a pasta com os .json'); process.exit(1); }

const ids = new Set([2019, 2020, 2021, 2022, 2023].flatMap(y =>
  JSON.parse(fs.readFileSync(path.join(here, '..', 'data', `q${y}.json`), 'utf8')).map(q => q.id)));

const found = {};
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
  Object.assign(found, JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

await ensureSchema();
const rows = [];
const ruins = [];
for (const [id, t] of Object.entries(found)) {
  if (!ids.has(id)) { ruins.push(`${id} (id desconhecido)`); continue; }
  if (typeof t !== 'string' || !/\[RESUMO\]/.test(t) || !/\[PASSOS\]/.test(t)) { ruins.push(`${id} (formato)`); continue; }
  rows.push([id, t.trim()]);
}
for (let i = 0; i < rows.length; i += 50) {
  const part = rows.slice(i, i + 50), at = Date.now();
  await sql`INSERT INTO explicacoes (qid, t, at, v)
            SELECT x.qid, x.t, ${at}, 2 FROM jsonb_to_recordset(${JSON.stringify(part.map(([qid, t]) => ({ qid, t })))}::jsonb) AS x(qid text, t text)
            ON CONFLICT (qid) DO UPDATE SET t = EXCLUDED.t, at = EXCLUDED.at, v = EXCLUDED.v`;
}
const faltam = [...ids].filter(id => !rows.some(([r]) => r === id));
console.log(`Gravadas: ${rows.length} de ${ids.size}`);
if (ruins.length) console.log('Rejeitadas:', ruins.join(', '));
if (faltam.length) console.log(`Faltando (${faltam.length}):`, faltam.join(', '));
