// Prompts e chamada ao Gemini para ler e corrigir redações no padrão do ENEM (Cartilha do Participante do INEP).
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

export async function gemini(parts, { schema, maxOutputTokens = 16000, thinkingLevel } = {}) {
  const KEY = process.env.GEMINI_API_KEY;
  if (!KEY) throw Object.assign(new Error('sem_chave_gemini'), { status: 500 });
  const generationConfig = { maxOutputTokens, responseMimeType: 'application/json', responseSchema: schema };
  if (thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel };
  for (let t = 0; t < 3; t++) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': KEY },
      body: JSON.stringify({ contents: [{ parts }], generationConfig }),
    });
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 2500 * (t + 1))); continue; }
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || String(r.status));
    const raw = (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
    try { return JSON.parse(raw); } catch { throw new Error('resposta_invalida: ' + raw.slice(0, 200)); }
  }
  throw Object.assign(new Error('limite_gemini'), { status: 503 });
}

// ---------- leitura da foto ----------
export const SCHEMA_LEITURA = {
  type: 'OBJECT',
  properties: {
    texto: { type: 'STRING' },
    legivel: { type: 'BOOLEAN' },
    observacao: { type: 'STRING' },
  },
  required: ['texto', 'legivel'],
};

export const PROMPT_LEITURA = `A imagem é a foto de uma redação de estudante (manuscrita ou impressa), em português.
Transcreva o texto da redação com fidelidade total:
- NÃO corrija nada. Mantenha exatamente os erros de ortografia, acentuação, pontuação, concordância e as palavras como o estudante escreveu, porque a redação ainda vai ser avaliada.
- Separe cada parágrafo com uma linha em branco. Não quebre linhas dentro do parágrafo.
- Ignore palavras riscadas, rasuras, numeração de linhas, cabeçalhos da folha e anotações fora do texto.
- Se houver título, coloque-o na primeira linha.
- Se uma palavra estiver ilegível, escreva [ilegível] no lugar dela.
- Em "legivel", responda false se a foto não tiver uma redação ou se a maior parte for impossível de ler; nesse caso explique em "observacao" (ex.: foto tremida, cortada, escura) e deixe "texto" vazio ou só com o que foi possível ler.`;

// ---------- correção ----------
export const SCHEMA_CORRECAO = {
  type: 'OBJECT',
  properties: {
    notaZero: { type: 'BOOLEAN' },
    motivoZero: { type: 'STRING' },
    competencias: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          numero: { type: 'INTEGER' },
          nota: { type: 'INTEGER' },
          nivel: { type: 'STRING' },
          comentario: { type: 'STRING' },
          comoMelhorar: { type: 'STRING' },
        },
        required: ['numero', 'nota', 'nivel', 'comentario', 'comoMelhorar'],
      },
    },
    desvios: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          trecho: { type: 'STRING' },
          correcao: { type: 'STRING' },
          explicacao: { type: 'STRING' },
        },
        required: ['trecho', 'correcao', 'explicacao'],
      },
    },
    proposta: {
      type: 'OBJECT',
      properties: {
        agente: { type: 'STRING' },
        acao: { type: 'STRING' },
        meio: { type: 'STRING' },
        finalidade: { type: 'STRING' },
        detalhamento: { type: 'STRING' },
      },
      required: ['agente', 'acao', 'meio', 'finalidade', 'detalhamento'],
    },
    repertorios: { type: 'ARRAY', items: { type: 'STRING' } },
    pontosFortes: { type: 'ARRAY', items: { type: 'STRING' } },
    pontosAMelhorar: { type: 'ARRAY', items: { type: 'STRING' } },
    comentarioGeral: { type: 'STRING' },
  },
  required: ['notaZero', 'motivoZero', 'competencias', 'desvios', 'proposta', 'repertorios', 'pontosFortes', 'pontosAMelhorar', 'comentarioGeral'],
};

const MATRIZ = `MATRIZ DE REFERÊNCIA DA REDAÇÃO DO ENEM (INEP). Cada competência vale 0, 40, 80, 120, 160 ou 200 pontos. Use SOMENTE esses valores.

COMPETÊNCIA 1 — Demonstrar domínio da modalidade escrita formal da Língua Portuguesa.
Avalia: estrutura sintática (períodos truncados, justapostos, excesso de vírgulas no lugar de ponto, falta de paralelismo) e desvios de convenções da escrita (ortografia, acentuação, hífen, maiúsculas, separação silábica), de gramática (concordância verbal e nominal, regência, crase, pontuação, colocação pronominal, flexão) e de escolha de registro (informalidade, gírias, oralidade).
200: excelente domínio da modalidade escrita formal e de escolha de registro; desvios aceitos só como excepcionalidade e sem reincidência (no máximo 1 falha de estrutura sintática e até 2 desvios).
160: bom domínio, com poucos desvios gramaticais e de convenções da escrita (até 3 desvios).
120: domínio mediano, com alguns desvios (até 5 desvios).
80: domínio insuficiente, com muitos desvios gramaticais, de escolha de registro e de convenções da escrita.
40: domínio precário, de forma sistemática, com diversificados e frequentes desvios.
0: desconhecimento da modalidade escrita formal.

COMPETÊNCIA 2 — Compreender a proposta de redação e aplicar conceitos das várias áreas de conhecimento para desenvolver o tema, dentro dos limites estruturais do texto dissertativo-argumentativo em prosa.
Avalia: abordagem completa do tema (todas as palavras-chave do recorte temático, não só o assunto geral), estrutura dissertativo-argumentativa (introdução com tese, desenvolvimento, conclusão) e repertório sociocultural. Repertório só conta como produtivo se for LEGITIMADO (fonte reconhecível: lei, autor, obra, dado, fato histórico), PERTINENTE (ligado ao tema) e USADO DE FORMA PRODUTIVA (articulado ao argumento, não só citado como enfeite). Repertório baseado apenas nos textos motivadores não é repertório do estudante.
200: desenvolve o tema por meio de argumentação consistente, a partir de repertório sociocultural produtivo, e apresenta excelente domínio do texto dissertativo-argumentativo.
160: argumentação consistente e bom domínio do texto dissertativo-argumentativo, com proposição, argumentação e conclusão (repertório legitimado e pertinente, mas não produtivo, ou só no desenvolvimento).
120: argumentação previsível e domínio mediano do texto dissertativo-argumentativo, com proposição, argumentação e conclusão (repertório não legitimado, ou baseado nos textos motivadores).
80: desenvolve o tema recorrendo à cópia de trechos dos textos motivadores, ou domínio insuficiente do texto dissertativo-argumentativo, sem atender à estrutura com proposição, argumentação e conclusão.
40: apresenta o assunto, TANGENCIANDO o tema (trata do assunto geral, mas não do recorte específico), ou domínio precário do texto dissertativo-argumentativo, com traços constantes de outros tipos textuais.
0: fuga ao tema ou não atendimento à estrutura dissertativo-argumentativa (nesses casos a redação inteira recebe nota zero).

COMPETÊNCIA 3 — Selecionar, relacionar, organizar e interpretar informações, fatos, opiniões e argumentos em defesa de um ponto de vista.
Avalia: projeto de texto (planejamento visível, ideias encadeadas, cada parágrafo com uma função), desenvolvimento dos argumentos (explicar causas e consequências, não só listar), coerência e autoria (argumentos próprios, além do senso comum e dos textos motivadores).
200: informações, fatos e opiniões relacionados ao tema, de forma consistente e organizada, configurando autoria, em defesa de um ponto de vista.
160: relacionados ao tema, de forma organizada, com indícios de autoria.
120: relacionados ao tema, limitados aos argumentos dos textos motivadores e pouco organizados.
80: relacionados ao tema, mas desorganizados ou contraditórios e limitados aos argumentos dos textos motivadores.
40: pouco relacionados ao tema ou incoerentes, e sem defesa de um ponto de vista.
0: não relacionados ao tema e sem defesa de um ponto de vista.

COMPETÊNCIA 4 — Demonstrar conhecimento dos mecanismos linguísticos necessários para a construção da argumentação.
Avalia: coesão entre parágrafos (conectivos que ligam um parágrafo ao outro) e dentro dos parágrafos (entre períodos), uso de conectivos variados e adequados (ex.: "além disso", "portanto", "nesse sentido", "dessa forma", "em contrapartida"), referenciação (pronomes, sinônimos, hiperônimos, para evitar repetição) e ausência de repetições excessivas.
200: articula bem as partes do texto e apresenta repertório diversificado de recursos coesivos (presença constante de elementos coesivos inter e intraparágrafos, raras ou nenhuma inadequação, sem repetição).
160: articula as partes do texto com poucas inadequações e repertório diversificado de recursos coesivos.
120: articula de forma mediana, com inadequações, e repertório pouco diversificado de recursos coesivos.
80: articula de forma insuficiente, com muitas inadequações, e repertório limitado de recursos coesivos.
40: articula as partes do texto de forma precária.
0: não articula as informações.

COMPETÊNCIA 5 — Elaborar proposta de intervenção para o problema abordado, respeitando os direitos humanos.
A proposta tem 5 elementos válidos possíveis: AGENTE (quem executa), AÇÃO (o que fazer), MODO/MEIO (como ou por meio de quê), FINALIDADE/EFEITO (para quê) e DETALHAMENTO (informação a mais sobre um dos elementos: um exemplo, uma explicação, um aprofundamento). Conte só elementos claros e relacionados ao tema.
200: proposta muito bem elaborada, detalhada, relacionada ao tema e articulada à discussão do texto (5 elementos válidos).
160: bem elaborada, relacionada ao tema e articulada à discussão (4 elementos).
120: de forma mediana, relacionada ao tema e articulada à discussão (3 elementos).
80: de forma insuficiente, relacionada ao tema, ou não articulada com a discussão (2 elementos).
40: vaga, precária ou relacionada apenas ao assunto (1 elemento).
0: não apresenta proposta, ou proposta não relacionada ao tema ou ao assunto. Proposta que desrespeite os direitos humanos (ex.: tortura, pena de morte, violência, exclusão de grupos) não é considerada e a competência 5 recebe 0.

SITUAÇÕES DE NOTA ZERO NA REDAÇÃO INTEIRA (notaZero = true, todas as competências = 0):
- fuga total ao tema;
- não obediência à estrutura dissertativo-argumentativa (ex.: poema, narrativa, carta);
- texto insuficiente: equivalente a até 7 linhas manuscritas (menos de cerca de 70 palavras);
- cópia integral de textos motivadores, ou parte do texto deliberadamente desconectada do tema (ex.: receita, hino, letra de música sem relação);
- impropérios, desenhos ou outras formas propositais de anulação;
- texto predominantemente em língua estrangeira.
O desrespeito aos direitos humanos NÃO zera a redação; zera só a competência 5.`;

export function promptCorrecao(tema, texto) {
  return `Você é um corretor experiente da banca oficial da redação do ENEM, treinado pela Cartilha do Participante do INEP. Corrija a redação do estudante com o mesmo rigor da banca real: não infle notas, não seja artificialmente gentil e não puna além do que a matriz manda. Uma redação mediana de estudante costuma ficar entre 480 e 720; 880 ou mais só para textos realmente muito bons.

${MATRIZ}

TEMA DA PROPOSTA: ${tema ? `"${tema}"` : '(não informado — identifique o tema que o próprio texto propõe e avalie a coerência com ele; não considere fuga ao tema)'}
${tema ? 'Compare o texto com o recorte exato do tema. Se o estudante só falar do assunto geral, é tangenciamento (C2 = 40, e C3 e C5 também ficam limitadas). Se não tiver relação nenhuma com o tema, é fuga ao tema (nota zero).' : ''}

COMO RESPONDER (tudo em português do Brasil, falando diretamente com o estudante, em "você"):
- competencias: exatamente 5 itens, numero de 1 a 5, na ordem. "nota" só pode ser 0, 40, 80, 120, 160 ou 200. "nivel" é uma frase curta com o descritor do nível atingido. "comentario" explica a nota citando trechos do texto entre aspas. "comoMelhorar" dá uma orientação prática e específica para subir de nível nessa competência.
- desvios: liste os desvios de Competência 1 encontrados (até 15), cada um com o trecho exato do estudante, a forma correta e uma explicação curta da regra. Se não houver, lista vazia.
- proposta: para cada elemento da proposta de intervenção, copie o trecho do texto que o cumpre; deixe string vazia se o elemento não existir ou não for válido.
- repertorios: liste os repertórios socioculturais usados (autor, lei, dado, fato) e diga em poucas palavras se foram produtivos. Lista vazia se não houver.
- pontosFortes e pontosAMelhorar: de 2 a 5 itens cada, específicos para este texto.
- comentarioGeral: 2 a 4 frases com a visão geral e a prioridade número 1 para a próxima redação.
- notaZero e motivoZero: só true se cair em uma das situações de nota zero; motivoZero vazio caso contrário.
- Trechos marcados [ilegível] vieram de uma foto: não conte como desvio.

REDAÇÃO DO ESTUDANTE:
"""
${texto}
"""`;
}

const NIVEIS = [0, 40, 80, 120, 160, 200];
const nivel = n => NIVEIS.reduce((a, b) => Math.abs(b - n) < Math.abs(a - n) ? b : a, 0);
const str = v => typeof v === 'string' ? v : '';
const strs = v => Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).slice(0, 15) : [];

export function limparCorrecao(c) {
  const comps = [1, 2, 3, 4, 5].map(n => {
    const x = (Array.isArray(c.competencias) ? c.competencias : []).find(k => Number(k?.numero) === n) || {};
    return { numero: n, nota: c.notaZero ? 0 : nivel(Number(x.nota) || 0), nivel: str(x.nivel), comentario: str(x.comentario), comoMelhorar: str(x.comoMelhorar) };
  });
  const p = c.proposta || {};
  return {
    notaZero: !!c.notaZero, motivoZero: c.notaZero ? str(c.motivoZero) : '',
    nota: comps.reduce((s, k) => s + k.nota, 0),
    competencias: comps,
    desvios: (Array.isArray(c.desvios) ? c.desvios : []).slice(0, 15).map(d => ({ trecho: str(d?.trecho), correcao: str(d?.correcao), explicacao: str(d?.explicacao) })).filter(d => d.trecho),
    proposta: { agente: str(p.agente), acao: str(p.acao), meio: str(p.meio), finalidade: str(p.finalidade), detalhamento: str(p.detalhamento) },
    repertorios: strs(c.repertorios),
    pontosFortes: strs(c.pontosFortes),
    pontosAMelhorar: strs(c.pontosAMelhorar),
    comentarioGeral: str(c.comentarioGeral),
  };
}
