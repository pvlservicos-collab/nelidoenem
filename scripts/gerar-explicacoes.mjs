// Gera as explicações de todas as questões com o Claude e grava na tabela "explicacoes" do Neon.
//
// Uso (precisa de DATABASE_URL e ANTHROPIC_API_KEY no .env.local):
//   node --env-file=.env.local scripts/gerar-explicacoes.mjs --teste 3     -> gera 3 na hora e mostra (não grava)
//   node --env-file=.env.local scripts/gerar-explicacoes.mjs               -> manda todas que faltam num lote (Batch API, 50% mais barato)
//   node --env-file=.env.local scripts/gerar-explicacoes.mjs --refazer     -> refaz todas, inclusive as que já existem
// Se o script for interrompido, rode de novo: ele retoma o lote salvo em scripts/.lote-atual.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { sql, ensureSchema } from '../api/_lib/db.js';
import { promptFor, imageKeys } from './prompt.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const LOTE = path.join(here, '.lote-atual');
const MODEL = 'claude-opus-5-5';
const args = process.argv.slice(2);
const teste = args.includes('--teste') ? +(args[args.indexOf('--teste') + 1] || 3) : 0;
const refazer = args.includes('--refazer');

const client = new Anthropic();
const readJson = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
const Q = [2019, 2020, 2021, 2022, 2023].flatMap(y => readJson(`q${y}.json`));
const shards = {};
const shard = sh => (shards[sh] ||= readJson(`i${sh}.json`));

function paramsFor(q) {
  const content = [];
  for (const k of [...new Set(imageKeys(q))]) {
    const d = shard(q.sh)[k];
    const m = d && d.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,(.+)$/);
    if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({ type: 'text', text: promptFor(q) });
  return {
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content }],
  };
}

const textOf = msg => msg.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
const valid = t => /\[RESUMO\]/.test(t) && /\[PASSOS\]/.test(t);

async function save(qid, t) {
  await sql`INSERT INTO explicacoes (qid, t, at, v) VALUES (${qid}, ${t}, ${Date.now()}, 2)
            ON CONFLICT (qid) DO UPDATE SET t = EXCLUDED.t, at = EXCLUDED.at, v = EXCLUDED.v`;
}

await ensureSchema();

if (teste) {
  const amostra = [Q.find(q => q.d === 'M'), Q.find(q => q.d === 'H'), Q.find(q => q.files.length), Q.find(q => q.d === 'N'), Q.find(q => q.d === 'L')].filter(Boolean).slice(0, teste);
  for (const q of amostra) {
    const msg = await client.messages.create(paramsFor(q));
    console.log(`\n===== ${q.id} (gabarito ${q.ok}) · ${msg.usage.input_tokens} in / ${msg.usage.output_tokens} out · ${msg.stop_reason}\n${textOf(msg)}`);
  }
  process.exit(0);
}

let batchId = fs.existsSync(LOTE) ? fs.readFileSync(LOTE, 'utf8').trim() : null;
if (!batchId) {
  const feitas = new Set(refazer ? [] : (await sql`SELECT qid FROM explicacoes WHERE v >= 2`).map(r => r.qid));
  const faltam = Q.filter(q => !feitas.has(q.id));
  console.log(`${Q.length} questões · ${feitas.size} já prontas · ${faltam.length} para gerar`);
  if (!faltam.length) process.exit(0);
  const batch = await client.messages.batches.create({
    requests: faltam.map(q => ({ custom_id: q.id, params: paramsFor(q) })),
  });
  batchId = batch.id;
  fs.writeFileSync(LOTE, batchId);
  console.log(`Lote enviado: ${batchId}`);
} else {
  console.log(`Retomando lote ${batchId}`);
}

let batch;
for (;;) {
  batch = await client.messages.batches.retrieve(batchId);
  const c = batch.request_counts;
  console.log(`${new Date().toLocaleTimeString('pt-BR')} · ${batch.processing_status} · prontas ${c.succeeded} · processando ${c.processing} · erros ${c.errored}`);
  if (batch.processing_status === 'ended') break;
  await new Promise(r => setTimeout(r, 60_000));
}

let ok = 0, ruins = [];
let inTok = 0, outTok = 0;
for await (const r of await client.messages.batches.results(batchId)) {
  if (r.result.type !== 'succeeded') { ruins.push(`${r.custom_id} (${r.result.type})`); continue; }
  const msg = r.result.message;
  inTok += msg.usage.input_tokens; outTok += msg.usage.output_tokens;
  const t = textOf(msg);
  if (msg.stop_reason === 'refusal' || !valid(t)) { ruins.push(`${r.custom_id} (${msg.stop_reason})`); continue; }
  await save(r.custom_id, t);
  ok++;
}
fs.rmSync(LOTE, { force: true });
const custo = (inTok * 4 + outTok * 20) / 1e6 / 2;
console.log(`\nGravadas: ${ok} · com problema: ${ruins.length}${ruins.length ? ' -> ' + ruins.join(', ') : ''}`);
console.log(`Tokens: ${inTok} entrada / ${outTok} saída · custo aproximado US$ ${custo.toFixed(2)}`);
if (ruins.length) console.log('Rode o script de novo para tentar as que falharam.');
