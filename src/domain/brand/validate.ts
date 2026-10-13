/**
 * Checklist do capítulo 16 do brandbook, em código.
 *
 * O brandbook é normativo: "onde ele diz 'nunca', é nunca". Um modelo pode ser
 * instruído a seguir a norma, mas não pode ser confiado a segui-la — é o mesmo
 * raciocínio das invariantes em src/brain/index.ts. Aqui as regras de texto
 * (§9.3 léxico, §10 legenda, §11 emoji e hashtag, §5.6 unidades, §2.1 grafia)
 * viram verificação determinística.
 *
 * `erro` = regra explícita do brandbook. `aviso` = heurística que pode ter falso
 * positivo e serve para o humano olhar, não para bloquear.
 */

export type Severidade = "erro" | "aviso";
export interface Problema {
  regra: string;
  severidade: Severidade;
  detalhe: string;
}

// --- §11.3 lista branca / §11.4 lista negra ---

const EMOJI_PERMITIDOS = new Set(["✓", "▪", "→", "📐", "🔧", "🏗️", "🏗", "📍", "📞", "📲"]);
const EMOJI_BANIDOS = new Set(["🔥", "😍", "🤩", "🙏", "👏", "✨", "💯", "🚀", "❤️", "❤", "💙", "🩵", "🤝", "🎉", "👉", "👇", "⚠️", "⚠", "💡", "⭐"]);

/** Sequência de emoji (com seletor de variação e ZWJ) ou os três símbolos de texto da lista branca. */
const RE_EMOJI = /(?:\p{Extended_Pictographic}(?:️)?(?:‍\p{Extended_Pictographic}(?:️)?)*|[✓▪→])/gu;

function ehRosto(e: string): boolean {
  const cp = e.codePointAt(0) ?? 0;
  return (
    (cp >= 0x1f600 && cp <= 0x1f64f) || // emoticons
    (cp >= 0x1f910 && cp <= 0x1f93a) || // rostos adicionais
    (cp >= 0x1f970 && cp <= 0x1f97a) ||
    (cp >= 0x1fae0 && cp <= 0x1faf8)
  );
}

// --- §9.3 léxico proibido ---

const LEXICO_PROIBIDO: { re: RegExp; porque: string }[] = [
  { re: /soluç(ão|ões)\s+inovador/i, porque: "adjetivo vazio — diga o fato" },
  { re: /\bexcelência\b/i, porque: "adjetivo vazio — diga o fato" },
  { re: /referência\s+(no|do)\s+mercado/i, porque: "adjetivo vazio — diga o fato" },
  { re: /\bsomos\s+referência\b/i, porque: "adjetivo vazio — troque por 'seis filiais no Maranhão, Pará e Piauí'" },
  { re: /\bo\s+melhor\b|\ba\s+melhor\b|\bos\s+melhores\b/i, porque: "superlativo sem prova" },
  { re: /\bo\s+maior\b|\ba\s+maior\b/i, porque: "superlativo sem prova" },
  { re: /\bincompar[áa]vel\b/i, porque: "superlativo sem prova" },
  { re: /venha\s+conferir/i, porque: "urgência de varejo" },
  { re: /n[ãa]o\s+perca/i, porque: "urgência de varejo" },
  { re: /corre\s+que\s+acaba/i, porque: "urgência de varejo" },
  { re: /\búltima\s+chance\b|\bimperd[íi]vel\b/i, porque: "urgência de varejo" },
  { re: /voc[êe]\s+sabia/i, porque: "abertura de perfil genérico" },
  { re: /parceiro\s+de\s+sucesso/i, porque: "jargão de agência" },
  { re: /conectando\s+pessoas/i, porque: "jargão de agência" },
  { re: /(produto|vidro)s?\s+de\s+alta\s+qualidade/i, porque: "diga a certificação (INMETRO, Falcão Bauer)" },
  { re: /atendimento\s+diferenciado/i, porque: "diga o fato — 'pronta entrega em tamanhos padronizados'" },
  { re: /transforme\s+seu\s+ambiente/i, porque: "promessa vazia — diga o benefício técnico" },
];

// --- §11.5 hashtag ---

const HASHTAGS_PROIBIDAS = [/^#vidrosdequalidade$/i, /^#vidros$/i, /^#qualidade$/i, /^#instagood$/i, /^#amei$/i];
const HASHTAG_MARCA = "#emvidros";
const TETO_HASHTAGS = 5;

// --- §10.3 CTA ---

const CTA_PATTERNS = [
  /fale\s+com\s+a\s+unidade/i,
  /pe[çc]a\s+o\s+or[çc]amento/i,
  /confira\s+a\s+espessura/i,
  /estamos\s+contratando/i,
  /salve\s+para\s+consultar/i,
  /link\s+na\s+bio/i,
  /chame\s+no\s+whats/i,
  /clique\s+(aqui|no\s+link)/i,
  /entre\s+em\s+contato/i,
];

// --- §5.6 unidades e números ---

const UNIDADES_ERRADAS: { re: RegExp; certo: string }[] = [
  { re: /\b\d+\s?MM\b/, certo: "use minúsculas com espaço: 10 mm" },
  { re: /\b\d+mm\b/, certo: "falta o espaço: 10 mm" },
  { re: /\bR\$\d/, certo: "espaço depois do R$: R$ 1.200,00" },
  { re: /\b\d+m2\b/i, certo: "use m²: 2 m²" },
  { re: /\b\d+\s?metros\s+quadrados\b/i, certo: "use m²: 2 m²" },
  { re: /0800-\d/, certo: "0800 150 0103, sem hífen" },
];

// --- §2.1 grafia ---

const SIGLAS_OK = new Set(["EM", "INMETRO", "ABNT", "NBR", "PVB", "ACM", "PVC", "MA", "PA", "PI", "CE", "CNPJ", "EPI", "CTA", "SP", "RJ", "PDF", "ISO"]);

function problemasDeGrafia(texto: string): Problema[] {
  const out: Problema[] = [];
  for (const forma of ["EM VIDROS", "EmVidros", "Em vidros", "Em Vidros"]) {
    if (texto.includes(forma))
      out.push({ regra: "§2.1 grafia do nome", severidade: "erro", detalhe: `"${forma}" é proibido. A forma única correta é "EM Vidros".` });
  }
  for (const forma of ["Imagine EM vidro", "imagine em vidro", "Imagine EM Vidros", "IMAGINE EM VIDRO"]) {
    if (texto.includes(forma))
      out.push({ regra: "§2.2 grafia da tagline", severidade: "erro", detalhe: `"${forma}" é proibido. A forma única correta é "Imagine EM Vidro".` });
  }
  return out;
}

function problemasDeCaixaAlta(texto: string): Problema[] {
  const out: Problema[] = [];
  const palavras = texto.split(/\s+/);
  let run: string[] = [];
  const fecharRun = () => {
    if (run.length > 4)
      out.push({
        regra: "§5.5 caixa alta",
        severidade: "erro",
        detalhe: `bloco de ${run.length} palavras em caixa alta ("${run.slice(0, 5).join(" ")}…"). Máximo 4, e nunca para dar ênfase (§10.5).`,
      });
    run = [];
  };
  for (const p of palavras) {
    const letras = p.replace(/[^\p{L}]/gu, "");
    // Minúscula quebra o bloco. Token sem letra (número, pontuação) ou de uma
    // letra só é neutro: não conta e não quebra — "R$ 1.200" no meio de um
    // bloco em caixa alta não deveria dividi-lo em dois.
    if (/\p{Ll}/u.test(letras)) fecharRun();
    else if (letras.length >= 2 && !SIGLAS_OK.has(letras)) run.push(p);
  }
  fecharRun();
  return out;
}

/** Bloco "Texto" do checklist do capítulo 16, aplicado a uma legenda de publicação. */
export function validarLegenda(legenda: string, opts: { pilar?: string } = {}): Problema[] {
  const out: Problema[] = [];
  const linhas = legenda.split("\n");
  const naoVazias = linhas.filter((l) => l.trim());
  const gancho = naoVazias[0]?.trim() ?? "";

  // §10.1 gancho: 1 linha, máx. 8 palavras, sem emoji, sem pergunta genérica
  // Aviso, não erro: §10.1 crava "máx. 8 palavras", mas o banco de legendas do
  // §10.4 e os exemplos "certos" do §10.2 têm 9 e 10 palavras. A norma se
  // contradiz aqui — vale sinalizar ao humano, não bloquear. Ver PENDÊNCIAS.md.
  const palavrasGancho = gancho.split(/\s+/).filter(Boolean).length;
  if (palavrasGancho > 8)
    out.push({ regra: "§10.1 gancho", severidade: "aviso", detalhe: `o gancho tem ${palavrasGancho} palavras; o §10.1 crava 8. "As primeiras 8 palavras são o post."` });
  if (RE_EMOJI.test(gancho))
    out.push({ regra: "§11.2 emoji", severidade: "erro", detalhe: "emoji na primeira linha. O gancho é texto." });
  RE_EMOJI.lastIndex = 0;

  // §9.3 léxico proibido
  for (const { re, porque } of LEXICO_PROIBIDO) {
    const m = legenda.match(re);
    if (m) out.push({ regra: "§9.3 léxico proibido", severidade: "erro", detalhe: `"${m[0]}" — ${porque}.` });
  }

  // §11 emoji
  const emojis = [...legenda.matchAll(RE_EMOJI)].map((m) => m[0]);
  if (emojis.length > 2)
    out.push({ regra: "§11.2 emoji", severidade: "erro", detalhe: `${emojis.length} emojis; o teto é 2 (preferencialmente zero).` });
  for (const e of emojis) {
    const base = e.replace(/️/g, "");
    if (EMOJI_BANIDOS.has(e) || EMOJI_BANIDOS.has(base))
      out.push({ regra: "§11.4 lista negra", severidade: "erro", detalhe: `${e} está na lista negra.` });
    else if (ehRosto(e)) out.push({ regra: "§11.4 lista negra", severidade: "erro", detalhe: `${e} é emoji de rosto — proibido.` });
    else if (!EMOJI_PERMITIDOS.has(e) && !EMOJI_PERMITIDOS.has(base))
      out.push({ regra: "§11.3 lista branca", severidade: "erro", detalhe: `${e} não está na lista branca (✓ ▪ → 📐 🔧 🏗️ 📍 📞 📲).` });
  }
  if (/(?:\p{Extended_Pictographic}(?:️)?){2}/u.test(legenda))
    out.push({ regra: "§11.2 emoji", severidade: "erro", detalhe: "dois emojis seguidos." });

  // §11.5 hashtag
  const hashtags = legenda.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (hashtags.length > TETO_HASHTAGS)
    out.push({ regra: "§11.5 hashtag", severidade: "erro", detalhe: `${hashtags.length} hashtags; o teto é ${TETO_HASHTAGS}.` });
  if (!hashtags.some((h) => h.toLowerCase() === HASHTAG_MARCA))
    out.push({ regra: "§11.5 hashtag", severidade: "erro", detalhe: "falta #EMVidros, que é fixa." });
  else if (hashtags[0]?.toLowerCase() !== HASHTAG_MARCA)
    out.push({ regra: "§11.5 hashtag", severidade: "erro", detalhe: `#EMVidros tem de ser a primeira; hoje a primeira é ${hashtags[0]}.` });
  for (const h of hashtags)
    if (HASHTAGS_PROIBIDAS.some((re) => re.test(h)))
      out.push({ regra: "§11.5 hashtag", severidade: "erro", detalhe: `${h} é tag genérica sem público real.` });
  for (const linha of linhas) {
    const t = linha.trim();
    if (!t.includes("#")) continue;
    const semTags = t.replace(/#[\p{L}\p{N}_]+/gu, "").trim();
    if (semTags.replace(/[^\p{L}\p{N}]/gu, "").length > 0)
      out.push({ regra: "§11.5 hashtag", severidade: "erro", detalhe: `hashtag dentro do texto ("${t.slice(0, 48)}…"). Elas vão em bloco separado, ao final.` });
  }

  // §10.3 CTA
  const ctas = CTA_PATTERNS.filter((re) => re.test(legenda));
  const pilar = opts.pilar?.toUpperCase();
  if (ctas.length > 1)
    out.push({ regra: "§10.3 CTA", severidade: "aviso", detalhe: `${ctas.length} CTAs detectados. Nunca dois no mesmo post.` });
  if (ctas.length > 0 && pilar === "MARCA")
    out.push({ regra: "§10.3 CTA", severidade: "erro", detalhe: "post do pilar MARCA (institucional / data comemorativa) não leva CTA." });

  // §10.5 regras de escrita
  const exclamacoes = (legenda.match(/!/g) ?? []).length;
  if (exclamacoes > 1)
    out.push({ regra: "§10.5 escrita", severidade: "erro", detalhe: `${exclamacoes} exclamações; o teto é 1 (de preferência nenhuma).` });
  if (/\*\*\*.+?\*\*\*/.test(legenda))
    out.push({ regra: "§10.5 escrita", severidade: "erro", detalhe: "negrito fingido com ***." });
  const decorativos = legenda.match(/[▬◆═►■□▲●]/g);
  if (decorativos)
    out.push({ regra: "§10.5 escrita", severidade: "erro", detalhe: `caractere decorativo ${[...new Set(decorativos)].join(" ")}.` });

  out.push(...problemasDeCaixaAlta(legenda));
  out.push(...problemasDeGrafia(legenda));

  // §5.6 unidades
  for (const { re, certo } of UNIDADES_ERRADAS) {
    const m = legenda.match(re);
    if (m) out.push({ regra: "§5.6 unidades", severidade: "erro", detalhe: `"${m[0]}" — ${certo}.` });
  }

  return out;
}

/** Texto que vai DENTRO da arte: §11.2.1 (emoji nunca na arte) + grafia + unidades. */
export function validarTextoDaArte(headline: string, apoio = ""): Problema[] {
  const out: Problema[] = [];
  const todo = `${headline}\n${apoio}`;

  if (RE_EMOJI.test(todo)) out.push({ regra: "§11.2 emoji", severidade: "erro", detalhe: "emoji na arte. Emoji vive só na legenda." });
  RE_EMOJI.lastIndex = 0;

  const palavras = headline.split(/\s+/).filter(Boolean).length;
  if (palavras > 8)
    out.push({ regra: "§6.4 composição", severidade: "aviso", detalhe: `headline com ${palavras} palavras. Headline longo vira mancha em miniatura.` });

  for (const { re, porque } of LEXICO_PROIBIDO) {
    const m = todo.match(re);
    if (m) out.push({ regra: "§9.3 léxico proibido", severidade: "erro", detalhe: `"${m[0]}" — ${porque}.` });
  }
  for (const { re, certo } of UNIDADES_ERRADAS) {
    const m = todo.match(re);
    if (m) out.push({ regra: "§5.6 unidades", severidade: "erro", detalhe: `"${m[0]}" — ${certo}.` });
  }
  out.push(...problemasDeCaixaAlta(todo));
  out.push(...problemasDeGrafia(todo));
  return out;
}

export const temErro = (ps: Problema[]) => ps.some((p) => p.severidade === "erro");

/** Formato para devolver ao modelo como function_result — ele reescreve e tenta de novo. */
export function formatarProblemas(ps: Problema[]): string {
  if (!ps.length) return "";
  return ps.map((p) => `- [${p.severidade}] ${p.regra}: ${p.detalhe}`).join("\n");
}
