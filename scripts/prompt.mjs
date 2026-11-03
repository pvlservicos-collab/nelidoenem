// Prompt das explicações curtas (estilo "resposta do Google").
// O index.html tem uma cópia de promptFor() com o mesmo texto; mantenha as duas iguais.
export const AREAS = {
  L: 'Linguagens, Códigos e suas Tecnologias',
  H: 'Ciências Humanas e suas Tecnologias',
  N: 'Ciências da Natureza e suas Tecnologias',
  M: 'Matemática e suas Tecnologias',
};

export function promptFor(q) {
  const a = q.d;
  const alts = q.alts.map(([L, t, img]) => `${L}) ${t ? t.replace(/!\[\]\(img:[\w-]+\)/g, '[figura]') : ''}${img ? ' [alternativa em imagem]' : ''}`).join('\n');
  const ctx = (q.ctx || '').replace(/!\[\]\(img:[\w-]+\)/g, '[figura]');
  const isCalc = a === 'M' || a === 'N';
  return `Você explica questões do ENEM para estudantes do ensino médio. Português do Brasil.

QUESTÃO — ENEM ${q.y}, ${AREAS[a]}, questão ${q.n}${q.lang ? ` (${q.lang})` : ''}
Texto-base:
${ctx || '(sem texto-base; veja as figuras enviadas)'}

Comando: ${q.intro || ''}
Alternativas:
${alts}

GABARITO OFICIAL DO INEP: ${q.ok}. Nunca contradiga esse gabarito.
${q.files.length || /\[figura\]/.test(ctx + alts) ? 'As figuras da questão vão anexadas como imagens, na ordem em que aparecem.' : ''}

ESTILO: curto como uma resposta do Google. Fatos, não redação.
- Frases curtas e diretas. Sem introdução, sem "vamos analisar", sem repetir o enunciado.
- Coloque em **negrito** só o fato decisivo (um termo, número ou trecho curto).
- Cada passo se apoia em um trecho do texto, um dado da questão ou um conceito. Nada de "é a correta porque é".
- Não invente leis, datas, autores ou números.

Responda EXATAMENTE com estes blocos, nesta ordem, cada marcador em linha própria:
[RESUMO]
Uma frase de no máximo 25 palavras que dá a resposta: alternativa ${q.ok} e o fato que decide.
[PASSOS]
De 2 a 4 linhas começando com "- ", cada uma com no máximo 15 palavras.
[ANOTACOES]
${isCalc ? 'Se houver conta: só as contas, uma por linha, no máximo 6 linhas, com × para multiplicação, / para divisão e ^ para potência. A última linha começa com "=> " e traz o resultado. Se não houver conta, escreva "nenhuma".' : 'nenhuma'}
[ALTERNATIVAS]
Uma linha por alternativa INCORRETA, formato "letra: motivo", no máximo 10 palavras cada.
[HABILIDADE]
"H00 | como a questão cobra a habilidade, no máximo 12 palavras", usando a Matriz de Referência do ENEM (INEP) de ${AREAS[a]}.`;
}

// Retorna as chaves de imagem na ordem em que aparecem.
export const imageKeys = q => [...String(q.ctx || '').matchAll(/img:([\w-]+)/g)].map(m => m[1])
  .concat(q.files, q.alts.map(x => x[2]).filter(Boolean));
