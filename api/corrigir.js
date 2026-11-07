import { readBody, fail } from './_lib/db.js';

// POST /api/corrigir {texto?, imagem?: dataURL, tema?} -> correção da redação pelo Gemini
export const config = { maxDuration: 60 };

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';
const KEY = process.env.GEMINI_API_KEY;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    textoTranscrito: { type: 'STRING' },
    nota: { type: 'NUMBER' },
    competencias: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          numero: { type: 'NUMBER' },
          nome: { type: 'STRING' },
          nota: { type: 'NUMBER' },
          comentario: { type: 'STRING' },
        },
        required: ['numero', 'nome', 'nota', 'comentario'],
      },
    },
    pontosFortes: { type: 'ARRAY', items: { type: 'STRING' } },
    pontosAMelhorar: { type: 'ARRAY', items: { type: 'STRING' } },
    comentarioGeral: { type: 'STRING' },
  },
  required: ['nota', 'competencias', 'pontosFortes', 'pontosAMelhorar', 'comentarioGeral'],
};

const COMPETENCIAS = `Competência 1 (0-200): Domínio da modalidade escrita formal da língua portuguesa.
Competência 2 (0-200): Compreender a proposta e aplicar conceitos de várias áreas de conhecimento para desenvolver o tema, dentro dos limites estruturais do texto dissertativo-argumentativo.
Competência 3 (0-200): Selecionar, relacionar, organizar e interpretar informações, fatos, opiniões e argumentos em defesa de um ponto de vista.
Competência 4 (0-200): Demonstrar conhecimento dos mecanismos linguísticos necessários para a construção da argumentação.
Competência 5 (0-200): Elaborar proposta de intervenção para o problema abordado, respeitando os direitos humanos.`;

function buildPrompt(tema, temTexto) {
  return `Você é um corretor oficial de redações do ENEM, experiente e rigoroso, mas justo. Corrija a redação seguindo EXATAMENTE as 5 competências do ENEM:
${COMPETENCIAS}

${tema ? `Tema proposto: "${tema}". Se o texto não discutir esse tema, ou apenas tangenciá-lo, reduza bastante (ou zere) a nota da competência 2 e explique isso no comentário.` : 'Nenhum tema específico foi informado; avalie se o texto tem um tema claro e se ele é desenvolvido de forma coerente como texto dissertativo-argumentativo.'}

Seja honesto e específico: cite trechos do texto do estudante nos comentários, aponte erros concretos de português, de argumentação e de estrutura, e dê sugestões práticas de como melhorar. Não seja genérico nem artificialmente gentil. A nota final (campo "nota") é a soma das 5 competências (0 a 1000).${temTexto ? '' : '\n\nHá uma foto da redação anexa. Primeiro transcreva fielmente o texto manuscrito ou digitado, preservando os parágrafos, e preencha o campo "textoTranscrito" com essa transcrição. Depois corrija o texto transcrito.'}`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  if (!KEY) return res.status(500).json({ error: 'sem_chave_gemini' });
  try {
    const { texto, imagem, tema } = await readBody(req);
    const temTexto = typeof texto === 'string' ? texto.trim().slice(0, 8000) : '';
    const temImagem = typeof imagem === 'string' && /^data:image\/[\w+.-]+;base64,/.test(imagem);
    if (!temTexto && !temImagem) return res.status(400).json({ error: 'dados_invalidos' });

    const parts = [];
    if (temImagem) {
      const m = imagem.match(/^data:(image\/[\w+.-]+);base64,(.+)$/);
      if (!m || m[2].length > 8_000_000) return res.status(400).json({ error: 'imagem_invalida' });
      parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
    const temaLimpo = typeof tema === 'string' ? tema.trim().slice(0, 300) : '';
    parts.push({ text: buildPrompt(temaLimpo, temTexto) + (temTexto ? `\n\nRedação do estudante:\n"""\n${temTexto}\n"""` : '') });

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': KEY },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { maxOutputTokens: 4000, responseMimeType: 'application/json', responseSchema: SCHEMA },
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || String(r.status));
    const raw = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    let out;
    try { out = JSON.parse(raw); } catch { throw new Error('resposta_invalida: ' + raw.slice(0, 200)); }
    out.nota = Math.max(0, Math.min(1000, Math.round(Number(out.nota) || 0)));
    out.competencias = Array.isArray(out.competencias) ? out.competencias.map(c => ({
      numero: Number(c.numero) || 0, nome: String(c.nome || ''),
      nota: Math.max(0, Math.min(200, Math.round(Number(c.nota) || 0))), comentario: String(c.comentario || ''),
    })) : [];
    res.status(200).json(out);
  } catch (e) { fail(res, e); }
}
