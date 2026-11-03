// Lê as questões COM as imagens (inclusive das alternativas) usando o Gemini e grava a explicação no Neon.
// Só grava quando o Gemini diz que chegou ao gabarito sozinho ([CONFERE] sim) e o resumo cita a letra certa.
// Uso (GEMINI_API_KEY e DATABASE_URL no .env.local):
//   node --env-file=.env.local scripts/gemini-explicar.mjs 2022-147 2021-145   -> só essas
//   node --env-file=.env.local scripts/gemini-explicar.mjs --imagens           -> todas as questões que têm imagem
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql, ensureSchema } from '../api/_lib/db.js';
import { promptFor, imageKeys } from './prompt.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = f => JSON.parse(fs.readFileSync(path.join(here, '..', 'data', f), 'utf8'));
const Q = [2019, 2020, 2021, 2022, 2023].flatMap(y => read(`q${y}.json`));
const shards = {};
const shard = s => (shards[s] ||= read(`i${s}.json`));
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';
const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('Falta GEMINI_API_KEY'); process.exit(1); }

const args = process.argv.slice(2);
const alvo = args.includes('--imagens') ? Q.filter(q => imageKeys(q).length) : Q.filter(q => args.includes(q.id));
const dry = args.includes('--sem-gravar');

const EXTRA = `

IMPORTANTE: as imagens anexas são as figuras, tabelas, gráficos e alternativas da questão, na ordem em que aparecem. Olhe TODAS antes de responder. Resolva a questão por conta própria, SEM olhar o gabarito, e só depois compare.
Acrescente no fim, depois de [HABILIDADE], mais um bloco:
[CONFERE]
Escreva só "sim" se a sua resolução independente chegou à alternativa ${'${OK}'}, ou "nao" se chegou a outra ou se faltam dados na questão (nesse caso diga em uma linha o que falta).`;

async function gemini(q) {
  const parts = [];
  for (const k of [...new Set(imageKeys(q))]) {
    const m = (shard(q.sh)[k] || '').match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
    if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
  }
  parts.push({ text: promptFor(q).replace(/GABARITO OFICIAL DO INEP: \w\. Nunca contradiga esse gabarito\./, 'O gabarito oficial é informado só no fim.') + EXTRA.replace('${OK}', q.ok) });
  for (let t = 0; t < 6; t++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-goog-api-key': KEY },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: 8000 } }),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 4000 * (t + 1))); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || r.status);
    return (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
  }
  throw new Error('limite de uso');
}

function contaTemNumeros(q, txt) {
  if (q.d !== 'M' && q.d !== 'N') return true;
  const a = (txt.match(/\[ANOTACOES\]([\s\S]*?)\[ALTERNATIVAS\]/) || [])[1] || '';
  if (/^\s*nenhuma/i.test(a)) return true;
  return /\d/.test(a.replace(/=>.*/g, '')); // precisa de ao menos uma linha de conta com número
}

await ensureSchema();
const resultados = {}, rejeitadas = [];
let i = 0, gravadas = 0;
async function worker() {
  while (i < alvo.length) {
    const q = alvo[i++];
    try {
      const txt = await gemini(q);
      const confere = /\[CONFERE\]\s*sim/i.test(txt);
      const resumo = (txt.match(/\[RESUMO\]([\s\S]*?)\[PASSOS\]/) || [])[1] || '';
      const ok = /\[RESUMO\]/.test(txt) && /\[PASSOS\]/.test(txt) && /\[HABILIDADE\]/.test(txt) && confere && resumo.includes(q.ok) && contaTemNumeros(q, txt);
      resultados[q.id] = txt;
      if (!ok) { rejeitadas.push(`${q.id} (${confere ? 'formato' : 'não confere'})`); continue; }
      const limpo = txt.replace(/\s*\[CONFERE\][\s\S]*$/, '').trim();
      if (!dry) await sql`INSERT INTO explicacoes (qid, t, at, v) VALUES (${q.id}, ${limpo}, ${Date.now()}, 3)
                          ON CONFLICT (qid) DO UPDATE SET t = EXCLUDED.t, at = EXCLUDED.at, v = 3`;
      gravadas++;
    } catch (e) { rejeitadas.push(`${q.id} (${e.message})`); }
    if ((gravadas + rejeitadas.length) % 10 === 0) console.log(`${gravadas + rejeitadas.length}/${alvo.length} · gravadas ${gravadas}`);
  }
}
await Promise.all(Array.from({ length: 5 }, worker));
fs.writeFileSync(path.join(here, '.gemini-resultados.json'), JSON.stringify(resultados, null, 1));
console.log(`\nGravadas: ${gravadas} de ${alvo.length}`);
if (rejeitadas.length) console.log('Não gravadas:', rejeitadas.join(', '));
