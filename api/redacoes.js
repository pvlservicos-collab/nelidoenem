import { sql, ensureSchema, validKey, readBody, fail } from './_lib/db.js';
import { gemini, SCHEMA_LEITURA, PROMPT_LEITURA, SCHEMA_CORRECAO, promptCorrecao, limparCorrecao } from './_lib/enem.js';

// GET  /api/redacoes?key=…                                   -> {redacoes:[…]} (as do usuário, mais recentes primeiro)
// POST /api/redacoes {acao:'ler', imagem: dataURL}             -> {texto, legivel, observacao}
// POST /api/redacoes {acao:'corrigir', key, tema, texto, origem} -> redação salva com a correção
// POST /api/redacoes {acao:'apagar', key, id}                  -> {ok}
export const config = { maxDuration: 120 };

const linha = r => ({ id: Number(r.id), tema: r.tema, texto: r.texto, origem: r.origem, nota: r.nota, correcao: r.correcao, at: Number(r.at) });

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const key = req.query?.key;
      if (!validKey(key)) return res.status(400).json({ error: 'dados_invalidos' });
      await ensureSchema();
      const rows = await sql`SELECT * FROM redacoes_usuarios WHERE user_key = ${key} ORDER BY at DESC LIMIT 100`;
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ redacoes: rows.map(linha) });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
    const body = await readBody(req);

    if (body.acao === 'ler') {
      const m = typeof body.imagem === 'string' && body.imagem.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
      if (!m || m[2].length > 8_000_000) return res.status(400).json({ error: 'imagem_invalida' });
      const r = await gemini([{ inlineData: { mimeType: m[1], data: m[2] } }, { text: PROMPT_LEITURA }],
        { schema: SCHEMA_LEITURA, maxOutputTokens: 8000, thinkingLevel: 'low' });
      return res.status(200).json({ texto: String(r.texto || '').trim(), legivel: r.legivel !== false, observacao: String(r.observacao || '') });
    }

    if (body.acao === 'corrigir') {
      const { key } = body;
      const tema = typeof body.tema === 'string' ? body.tema.trim().slice(0, 300) : '';
      const texto = typeof body.texto === 'string' ? body.texto.trim().slice(0, 8000) : '';
      const origem = body.origem === 'foto' ? 'foto' : 'texto';
      if (!validKey(key) || !texto) return res.status(400).json({ error: 'dados_invalidos' });
      await ensureSchema();
      const [u] = await sql`SELECT key FROM users WHERE key = ${key}`;
      if (!u) return res.status(404).json({ error: 'usuario_nao_encontrado' });
      const correcao = limparCorrecao(await gemini([{ text: promptCorrecao(tema, texto) }], { schema: SCHEMA_CORRECAO }));
      const [r] = await sql`INSERT INTO redacoes_usuarios (user_key, tema, texto, origem, nota, correcao, at)
                            VALUES (${key}, ${tema}, ${texto}, ${origem}, ${correcao.nota}, ${JSON.stringify(correcao)}, ${Date.now()})
                            RETURNING *`;
      return res.status(200).json(linha(r));
    }

    if (body.acao === 'apagar') {
      const id = Number(body.id);
      if (!validKey(body.key) || !Number.isInteger(id)) return res.status(400).json({ error: 'dados_invalidos' });
      await ensureSchema();
      await sql`DELETE FROM redacoes_usuarios WHERE id = ${id} AND user_key = ${body.key}`;
      return res.status(200).json({ ok: true });
    }

    res.status(400).json({ error: 'acao_invalida' });
  } catch (e) {
    if (e.status === 503) return res.status(503).json({ error: 'limite_gemini' });
    fail(res, e);
  }
}
