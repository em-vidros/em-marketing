/**
 * Adaptadores falsos dos quatro papéis e das duas portas de efeito.
 *
 * Zero rede e zero relógio: todo artefato é função do hash da entrada, então o
 * mesmo brief devolve os mesmos bytes. É o que deixa o ensaio de ponta a ponta
 * rodar offline e comparar sha256 sem margem de tolerância.
 */

import { createHash } from "node:crypto";
import sharp from "sharp";
import tokens from "../../brand/tokens.json";
import { sha256 } from "./imagem";
import type { DirecaoVisual, Formato, Pedido } from "../modelos/tipos";
import type {
  Artigo,
  ContextoMarca,
  Designer,
  DiretorCriativo,
  DiretorDeArte,
  PortaLinear,
  PortaTelegram,
  Redator,
  Veredito,
} from "./tipos";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * 12 chars em base32 de Crockford é exatamente o orçamento que o codec de
 * aprovação reserva para o id da opção dentro do `callback_data` do Telegram.
 *
 * O separador é NUL porque é o único byte que não aparece nas partes: sem ele
 * ("ab", "c") e ("a", "bc") colidiriam no mesmo id.
 */
function idCurto(...partes: readonly string[]): string {
  const bytes = createHash("sha256").update(partes.join("\0")).digest();
  let saida = "";
  for (let i = 0; i < 12; i++) {
    const bit = i * 5;
    const byte = bit >> 3;
    const janela = ((bytes[byte]! << 8) | bytes[byte + 1]!) >> (11 - (bit & 7));
    saida += CROCKFORD[janela & 31]!;
  }
  return saida;
}

function fracao(semente: string, teto: number): number {
  return parseInt(sha256(semente).slice(0, 8), 16) % teto;
}

const cor = tokens.color;

interface Estilo {
  readonly id: string;
  readonly territorio: string;
  readonly composicao: string;
  readonly tipografia: string;
  readonly elementoPrincipal: string;
  readonly logoVariante: "cor" | "branco";
  readonly regraLogo: string;
  /** Ordem fixa: fundo, acento, apoio, texto — o designer falso lê por posição. */
  readonly paleta: readonly string[];
  readonly proibidos: readonly string[];
}

const ESTILOS: readonly Estilo[] = [
  {
    id: "minimal-editorial",
    territorio: "A. Minimal / Editorial",
    composicao: "fundo areia com muito respiro, headline grande alinhada à esquerda, herói centralizado abaixo",
    tipografia: "Montserrat Bold no headline, Inter no apoio",
    elementoPrincipal: "objeto 3D de vidro translúcido teal ligado ao tema",
    logoVariante: "cor",
    regraLogo: "logo colorido pequeno no rodapé, discreto",
    paleta: [cor.neutral.areia, cor.primary.tealEM, cor.accent.tealVivo, cor.text.carvao],
    proibidos: ["sombra dramática", "gradiente pesado", "foto de banco de imagem"],
  },
  {
    id: "tipografico-bold",
    territorio: "A. Minimal / Editorial",
    composicao: "texto ocupa 80% da composição, alinhamento assimétrico à esquerda, barra teal vertical",
    tipografia: "Montserrat Black gigante, entrelinha apertada",
    elementoPrincipal: "a própria frase, com palavras alternando teal e carvão",
    logoVariante: "cor",
    regraLogo: "logo colorido no canto, com a assinatura imagine em vidro",
    paleta: [cor.neutral.branco, cor.primary.tealEM, cor.accent.tealVivo, cor.text.carvao],
    proibidos: ["foto", "render 3D", "ilustração", "texto centralizado"],
  },
  {
    id: "produto-3d",
    territorio: "A. Minimal / Editorial",
    composicao: "herói 3D saindo da borda, blocos teal arredondados como janelas de informação",
    tipografia: "Montserrat ExtraBold no headline, apoio dentro dos blocos teal",
    elementoPrincipal: "render fotorrealista do produto de vidro com reflexo especular",
    logoVariante: "cor",
    regraLogo: "logo colorido no rodapé, fora do herói",
    paleta: [cor.neutral.cinza, cor.accent.tealVivo, cor.primary.tealEM, cor.text.carvao],
    proibidos: ["overlay teal pesado", "fundo escuro", "textura de confete"],
  },
  {
    id: "premium-escuro",
    territorio: "A. Minimal / Editorial",
    composicao: "fundo quase-preto com spotlight, herói iluminado ao centro e muito ar em volta",
    tipografia: "Montserrat Bold em branco, tracking generoso",
    elementoPrincipal: "objeto de vidro teal com glow, mood de showroom noturno",
    logoVariante: "branco",
    regraLogo: "logo branco, versão invertida oficial",
    paleta: [cor.dark.quasePreto, cor.accent.tealVivo, cor.primary.tealEM, cor.neutral.branco],
    proibidos: ["cor alegre", "elemento lúdico", "fundo claro"],
  },
  {
    id: "festivo-comemorativo",
    territorio: "B. Festivo / Comemorativo",
    composicao: "fundo azul-céu texturizado, balões cromados e confete discreto, skyline no rodapé",
    tipografia: "Montserrat ExtraBold com uma ou duas palavras em script inclinado",
    elementoPrincipal: "numeral gigante com outline branco e sombra petróleo",
    logoVariante: "cor",
    regraLogo: "logo colorido no rodapé, junto da silhueta da cidade",
    paleta: [cor.festive.azulCeu, cor.primary.tealEM, cor.festive.prata, cor.deep.petroleo],
    proibidos: ["tom memorial", "fundo escuro", "layout vazio demais"],
  },
  {
    id: "institucional-foto",
    territorio: "C. Institucional / Foto",
    composicao: "foto documental da fábrica com faixa de texto caixa-alta por cima",
    tipografia: "Montserrat ExtraBold branco em caixa-alta, kicker em pill teal",
    elementoPrincipal: "equipe ou porta-voz real, luz industrial de ambiente",
    logoVariante: "branco",
    regraLogo: "logo branco sobre a faixa escura",
    paleta: [cor.text.carvao, cor.primary.tealEM, cor.deep.petroleo, cor.neutral.branco],
    proibidos: ["foto de banco de imagem", "grading saturado", "render 3D"],
  },
];

interface Enquadramento {
  readonly chave: string;
  readonly recorte: string;
  readonly headline: (tema: string) => string;
  readonly apoio: string;
}

const ENQUADRAMENTOS: readonly Enquadramento[] = [
  {
    chave: "beneficio",
    recorte: "o benefício direto para quem compra",
    headline: (tema) => `${tema} do jeito certo`,
    apoio: "Medição, projeto e instalação com a mesma equipe.",
  },
  {
    chave: "duvida",
    recorte: "a dúvida mais comum do cliente",
    headline: (tema) => `${tema}: o que ninguém explica`,
    apoio: "A resposta curta que evita retrabalho caro.",
  },
  {
    chave: "prova",
    recorte: "a prova social de quem já fez",
    headline: (tema) => `${tema} que a gente entregou`,
    apoio: "Obras reais em Imperatriz e região.",
  },
  {
    chave: "bastidor",
    recorte: "o bastidor da fábrica",
    headline: (tema) => `Por dentro de ${tema}`,
    apoio: "Da chapa bruta ao vidro pronto para instalar.",
  },
  {
    chave: "convite",
    recorte: "o convite ao próximo passo",
    headline: (tema) => `Vamos falar de ${tema}?`,
    apoio: "Orçamento sem compromisso, resposta no mesmo dia.",
  },
  {
    chave: "comparacao",
    recorte: "a comparação que decide a compra",
    headline: (tema) => `${tema}: temperado ou laminado`,
    apoio: "Cada um resolve um problema. Um deles é o seu.",
  },
];

/**
 * Um enquadramento por estilo faz o giro da rodada ser bijeção. Com menos
 * enquadramentos do que estilos, dois candidatos da mesma rodada caem no mesmo
 * enquadramento e o usuário recebe duas direções com o mesmo headline, quando o
 * §3.5 confere justamente se as três são visualmente diferentes.
 */
if (ENQUADRAMENTOS.length !== ESTILOS.length)
  throw new Error("ENQUADRAMENTOS e ESTILOS precisam ter o mesmo tamanho.");

export class FakeDiretorCriativo implements DiretorCriativo {
  async direcoes(e: {
    pedido: Pedido;
    marca: ContextoMarca;
    rodada: number;
    excluir?: readonly string[];
  }): Promise<readonly DirecaoVisual[]> {
    const { pedido, marca, rodada } = e;
    const excluir = new Set(e.excluir ?? []);
    const total = ENQUADRAMENTOS.length;

    const candidatos = ESTILOS.map((estilo, indice) => {
      // O enquadramento gira com a rodada: a mesma dupla estilo/tema nunca repete
      // o direction_id que o usuário já recusou na rodada anterior.
      const giro = (((rodada - 1 + indice) % total) + total) % total;
      const enquadramento = ENQUADRAMENTOS[giro]!;
      const direcao: DirecaoVisual = {
        direction_id: idCurto(pedido.theme, estilo.id, enquadramento.chave, marca.brandVersionId),
        territory: estilo.territorio,
        composition: estilo.composicao,
        palette: [...estilo.paleta],
        typography: estilo.tipografia,
        main_element: estilo.elementoPrincipal,
        headline: enquadramento.headline(pedido.theme),
        support_text: enquadramento.apoio,
        logo_variant: estilo.logoVariante,
        logo_rule: estilo.regraLogo,
        rationale: `${estilo.territorio} aplicado a "${pedido.theme}" por ${enquadramento.recorte}: ${estilo.composicao}.`,
        prohibited_elements: [...estilo.proibidos],
      };
      return { ordem: sha256(`${pedido.theme}\0${rodada}\0${estilo.id}`), direcao };
    });

    const sobreviventes = candidatos
      .sort((a, b) => (a.ordem < b.ordem ? -1 : 1))
      .map((c) => c.direcao)
      .filter((d) => !excluir.has(d.direction_id));

    if (sobreviventes.length < 3) {
      throw new Error(
        `Direções esgotadas para "${pedido.theme}" na rodada ${rodada}: sobraram ${sobreviventes.length} de 3 depois de excluir ${excluir.size} já recusadas.`,
      );
    }
    return sobreviventes.slice(0, 3);
  }
}

const HASHTAGS = "#EMVidros #ImagineEmVidro #VidroTemperado #Vidracaria #Imperatriz #EMVidrosMA";

const LEGENDAS: readonly ((tema: string) => string)[] = [
  (tema) =>
    `Você já reparou como ${tema} muda um ambiente inteiro? 🩵\n\n` +
    "Na EM Vidros, cada projeto começa por uma conversa: entender o uso do espaço, medir com calma e escolher a espessura certa para aquela rotina. " +
    "Vidro bem especificado não é detalhe técnico, é conforto que você percebe todo dia, com segurança certificada e acabamento que sustenta o olhar de perto.\n\n" +
    "Salve este post e chame a nossa equipe para um orçamento sem compromisso. ✨",
  (tema) =>
    `${tema} pede mais do que um bom preço. 🩵\n\n` +
    "Pede medida conferida no local, ferragem compatível e instalação feita por quem responde depois. " +
    "É esse cuidado que evita a porta que raspa, o box que vaza e a troca cara seis meses adiante. " +
    "Trabalhamos com vidro temperado certificado e entregamos o serviço completo, do desenho ao aperto final do parafuso.\n\n" +
    "Comente aqui ou chame no direct: a gente monta o orçamento com você. ✨",
  (tema) =>
    `Tem uma pergunta que chega toda semana aqui: vale a pena investir em ${tema}? 🩵\n\n` +
    "Vale quando o vidro é escolhido pelo uso real e instalado por quem entende de estrutura. " +
    "A diferença aparece na luz que entra, no isolamento do barulho e na sensação de amplitude que nenhum outro material entrega. " +
    "Nossa equipe acompanha da visita técnica à limpeza final da obra.\n\n" +
    "Compartilhe com quem está reformando e fale com a gente pelo link da bio. ✨",
];

interface AnguloBlog {
  readonly titulo: (tema: string) => string;
  readonly angulo: string;
}

const ANGULOS_BLOG: readonly AnguloBlog[] = [
  {
    titulo: (tema) => `${tema}: guia prático para escolher sem errar`,
    angulo: "Guia de decisão passo a passo, do uso do ambiente à espessura do vidro.",
  },
  {
    titulo: (tema) => `Quanto custa ${tema} e o que muda o preço`,
    angulo: "Abre a formação de custo e mostra onde economizar sem perder segurança.",
  },
  {
    titulo: (tema) => `Cinco erros comuns em ${tema}`,
    angulo: "Lista os erros de medição e instalação que geram retrabalho.",
  },
  {
    titulo: (tema) => `${tema} na prática: o que aprendemos na fábrica`,
    angulo: "Bastidor técnico da têmpera e do controle de qualidade.",
  },
  {
    titulo: (tema) => `${tema} e manutenção: o que fazer a cada ano`,
    angulo: "Rotina de conservação e sinais de que a ferragem precisa de ajuste.",
  },
];

function slugificar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class FakeRedator implements Redator {
  async legenda(e: {
    pedido: Pedido;
    direcao: DirecaoVisual;
    marca: ContextoMarca;
    anterior?: string;
    ajuste?: string;
  }): Promise<string> {
    const escolha = fracao(
      `${e.pedido.theme}\0${e.direcao.direction_id}\0${e.marca.brandVersionId}\0${e.ajuste ?? ""}`,
      LEGENDAS.length,
    );
    const corpo = LEGENDAS[escolha]!(e.pedido.theme);
    const ajuste = e.ajuste ? `\n\n(${e.ajuste})` : "";
    return `${corpo}${ajuste}\n\n${HASHTAGS}`;
  }

  async angulos(e: { tema: string; marca: ContextoMarca }): Promise<readonly { titulo: string; angulo: string }[]> {
    return ANGULOS_BLOG.map((a) => ({
      ordem: sha256(`${e.tema}\0${e.marca.brandVersionId}\0${a.angulo}`),
      item: { titulo: a.titulo(e.tema), angulo: a.angulo },
    }))
      .sort((a, b) => (a.ordem < b.ordem ? -1 : 1))
      .slice(0, 3)
      .map((c) => c.item);
  }

  async artigo(e: {
    titulo: string;
    angulo: string;
    marca: ContextoMarca;
    fontes: readonly string[];
    ajuste?: string;
  }): Promise<Artigo> {
    const slug = slugificar(e.titulo);
    const ajuste = e.ajuste ? `\n\nRevisão desta versão: ${e.ajuste}.` : "";
    const fontes = e.fontes.length
      ? e.fontes.map((f) => `- ${f}`).join("\n")
      : "- Levantamento interno da EM Vidros";
    const markdown = [
      `# ${e.titulo}`,
      "",
      `Quem procura por ${e.titulo.toLowerCase()} quase sempre chega com a mesma pergunta: por onde começar. ${e.angulo}${ajuste}`,
      "",
      "## O que pesa na escolha",
      "",
      "Uso do ambiente, vão a cobrir e frequência de abertura definem a espessura e o tipo de vidro. Temperado responde bem a impacto e quebra em fragmentos sem corte; laminado segura o caco na película e resolve isolamento acústico.",
      "",
      "## Como a EM Vidros executa",
      "",
      "A visita técnica confere o vão real, não o vão do projeto. Da conferência sai o corte, a têmpera e a ferragem compatível com o peso da folha. A instalação é feita pela mesma equipe que mediu, o que elimina a discussão de responsabilidade quando algo precisa de ajuste.",
      "",
      "## Conclusão",
      "",
      "Vidro é decisão de longo prazo e o custo do erro aparece na troca, não na compra. Especificar pelo uso real custa uma conversa e economiza uma reforma.",
      "",
      "Fale com a EM Vidros e receba o orçamento com prazo e ficha técnica no mesmo documento.",
      "",
      "## Fontes",
      "",
      fontes,
      "",
    ].join("\n");

    return {
      titulo: e.titulo,
      markdown,
      tituloSeo: `${e.titulo} | EM Vidros`,
      descricaoSeo: `${e.angulo} Guia da EM Vidros sobre ${e.titulo.toLowerCase()}, com critérios de escolha, execução e manutenção.`.slice(0, 160),
      slug,
      pendencias: e.fontes.length ? [] : ["Sem fontes informadas: confirmar dados técnicos antes de publicar."],
    };
  }
}

function escaparXml(texto: string): string {
  return texto.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]!,
  );
}

function quebrar(texto: string, maxChars: number): string[] {
  const linhas: string[] = [];
  let atual = "";
  for (const palavra of texto.split(/\s+/).filter(Boolean)) {
    const teste = atual ? `${atual} ${palavra}` : palavra;
    if (teste.length > maxChars && atual) {
      linhas.push(atual);
      atual = palavra;
    } else {
      atual = teste;
    }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

async function sobreporLogo(
  logo: Buffer,
  formato: Formato,
  largura: number,
  altura: number,
): Promise<{ input: Buffer; left: number; top: number }> {
  const alvo = Math.round(largura / 5);
  const redimensionado = await sharp(logo).resize({ width: alvo }).png().toBuffer();
  const meta = await sharp(redimensionado).metadata();
  const logoLargura = meta.width ?? alvo;
  const logoAltura = meta.height ?? alvo;
  const margem = Math.round(largura * 0.06);

  if (formato === "stories") {
    // As zonas seguras do tokens.json estão em pixel do arquivo final (1080x1920);
    // a tela de geração é maior, então a margem escala junto ou o logo invade a zona.
    const escala = altura / tokens.formats.stories.final.height;
    const base = Math.round(tokens.formats.stories.safeZones.bottomPx * escala);
    return {
      input: redimensionado,
      left: Math.round((largura - logoLargura) / 2),
      top: altura - base - logoAltura,
    };
  }
  return { input: redimensionado, left: largura - logoLargura - margem, top: altura - logoAltura - margem };
}

export class FakeDesigner implements Designer {
  async gerar(e: {
    direcao: DirecaoVisual;
    formato: Formato;
    logo: Buffer;
  }): Promise<{ png: Buffer; modelo: string; refId?: string }> {
    const { width: largura, height: altura } = tokens.formats[e.formato].generation.expected;
    const [fundo, acento, apoio, texto] = e.direcao.palette;
    const borda = Math.round(largura * 0.025);
    const margem = Math.round(largura * 0.1);
    const corpo = Math.round(largura / 13);
    const linhasHeadline = quebrar(e.direcao.headline, 20);
    const topo = Math.round(altura * 0.28);

    const tspans = linhasHeadline
      .map(
        (linha, i) =>
          `<tspan x="${margem}" dy="${i === 0 ? 0 : Math.round(corpo * 1.18)}">${escaparXml(linha)}</tspan>`,
      )
      .join("");
    const baseApoio = topo + Math.round(corpo * 1.18) * linhasHeadline.length + Math.round(corpo * 0.9);
    const svgApoio = e.direcao.support_text
      ? `<text x="${margem}" y="${baseApoio}" font-family="sans-serif" font-size="${Math.round(corpo * 0.42)}" fill="${texto ?? "#3D3D3D"}" fill-opacity="0.78">${quebrar(
          e.direcao.support_text,
          44,
        )
          .map((l, i) => `<tspan x="${margem}" dy="${i === 0 ? 0 : Math.round(corpo * 0.55)}">${escaparXml(l)}</tspan>`)
          .join("")}</text>`
      : "";

    // font-family genérica de propósito: Montserrat não é garantida no host do CI.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${altura}">
<rect x="${borda}" y="${borda}" width="${largura - borda * 2}" height="${altura - borda * 2}" fill="${fundo ?? "#FFFFFF"}"/>
<rect x="${margem}" y="${topo - Math.round(corpo * 1.5)}" width="${Math.round(largura * 0.2)}" height="${Math.round(corpo * 0.14)}" fill="${acento ?? "#2C7A75"}"/>
<rect x="${margem + Math.round(largura * 0.22)}" y="${topo - Math.round(corpo * 1.5)}" width="${Math.round(largura * 0.06)}" height="${Math.round(corpo * 0.14)}" fill="${apoio ?? acento ?? "#2C7A75"}"/>
<text x="${margem}" y="${topo}" font-family="sans-serif" font-size="${corpo}" font-weight="700" fill="${texto ?? "#3D3D3D"}">${tspans}</text>
${svgApoio}
<text x="${margem}" y="${altura - Math.round(margem * 0.5)}" font-family="sans-serif" font-size="${Math.round(corpo * 0.3)}" fill="${acento ?? "#2C7A75"}">imagine em vidro</text>
</svg>`;

    const png = await sharp({
      create: { width: largura, height: altura, channels: 4, background: tokens.color.primary.tealEM },
    })
      .composite([
        { input: Buffer.from(svg), left: 0, top: 0 },
        await sobreporLogo(e.logo, e.formato, largura, altura),
      ])
      .png()
      .toBuffer();

    return { png, modelo: "fake-designer", refId: idCurto(e.direcao.direction_id, e.formato) };
  }

  async editar(e: {
    base: Buffer;
    instrucao: string;
    formato: Formato;
    logo: Buffer;
    refId?: string;
  }): Promise<{ png: Buffer; modelo: string; refId?: string }> {
    const meta = await sharp(e.base).metadata();
    if (!meta.width || !meta.height) throw new Error("Imagem base sem dimensão legível: não dá para editar.");
    const largura = meta.width;
    const altura = meta.height;

    const digest = sha256(e.instrucao);
    const matiz = {
      r: 60 + (parseInt(digest.slice(0, 2), 16) % 180),
      g: 60 + (parseInt(digest.slice(2, 4), 16) % 180),
      b: 60 + (parseInt(digest.slice(4, 6), 16) % 180),
    };

    const alturaFaixa = Math.round(altura * 0.18);
    const fonte = Math.round(largura / 30);
    const margem = Math.round(largura * 0.06);
    const linhas = quebrar(e.instrucao, 46).slice(0, 3);
    const faixa = `<svg xmlns="http://www.w3.org/2000/svg" width="${largura}" height="${alturaFaixa}">
<rect width="${largura}" height="${alturaFaixa}" fill="${tokens.color.deep.petroleo}"/>
<text x="${margem}" y="${Math.round(alturaFaixa * 0.42)}" font-family="sans-serif" font-size="${fonte}" fill="${tokens.color.neutral.branco}">${linhas
      .map((l, i) => `<tspan x="${margem}" dy="${i === 0 ? 0 : Math.round(fonte * 1.3)}">${escaparXml(l)}</tspan>`)
      .join("")}</text>
</svg>`;

    const png = await sharp(e.base)
      .tint(matiz)
      .composite([
        { input: Buffer.from(faixa), left: 0, top: altura - alturaFaixa },
        await sobreporLogo(e.logo, e.formato, largura, altura),
      ])
      .png()
      .toBuffer();

    return { png, modelo: "fake-designer", refId: e.refId };
  }
}

export const SENTINELA_REPROVAR = "__REPROVAR__";

export class FakeDiretorDeArte implements DiretorDeArte {
  async revisar(e: { png: Buffer; formato: Formato; direcao: DirecaoVisual; tema: string }): Promise<Veredito> {
    const semente = `${sha256(e.png)}\0${e.formato}\0${e.tema}\0${e.direcao.direction_id}`;
    if (e.direcao.headline.includes(SENTINELA_REPROVAR)) {
      return {
        aprovada: false,
        score: 4 + fracao(semente, 3),
        violacoes: [
          {
            criterio: "texto_na_arte",
            problema: `Headline carrega a sentinela ${SENTINELA_REPROVAR} e não pode ir para o cliente.`,
          },
        ],
      };
    }
    return { aprovada: true, score: 8 + fracao(semente, 3), violacoes: [] };
  }
}

interface Chamada {
  metodo: string;
  [campo: string]: unknown;
}

/** O PRD §4.11 proíbe byte de imagem em log: o registro guarda hash e tamanho. */
function resumo(bytes: Buffer): { sha256: string; bytes: number } {
  return { sha256: sha256(bytes), bytes: bytes.byteLength };
}

export class FakePortaTelegram implements PortaTelegram {
  readonly chamadas: Chamada[] = [];
  private readonly arquivos = new Map<string, Buffer>();
  private proximoId = 1;

  async enviarMensagem(chatId: number, texto: string, extra?: Record<string, unknown>): Promise<{ message_id: number }> {
    const message_id = this.proximoId++;
    this.chamadas.push({ metodo: "enviarMensagem", chatId, texto, extra, message_id });
    return { message_id };
  }

  async enviarAlbum(chatId: number, jpegs: readonly Buffer[], caption?: string): Promise<{ message_ids: number[] }> {
    const message_ids = jpegs.map(() => this.proximoId++);
    this.chamadas.push({ metodo: "enviarAlbum", chatId, caption, itens: jpegs.map(resumo), message_ids });
    return { message_ids };
  }

  async enviarFoto(chatId: number, jpeg: Buffer, extra?: Record<string, unknown>): Promise<{ message_id: number }> {
    const message_id = this.proximoId++;
    this.chamadas.push({ metodo: "enviarFoto", chatId, arquivo: resumo(jpeg), extra, message_id });
    return { message_id };
  }

  async enviarDocumento(
    chatId: number,
    arquivo: Buffer,
    nome: string,
    extra?: Record<string, unknown>,
  ): Promise<{ message_id: number; file_id: string }> {
    const file_id = idCurto("documento", sha256(arquivo));
    this.arquivos.set(file_id, arquivo);
    const message_id = this.proximoId++;
    this.chamadas.push({ metodo: "enviarDocumento", chatId, nome, arquivo: resumo(arquivo), extra, message_id, file_id });
    return { message_id, file_id };
  }

  async obterArquivo(fileId: string): Promise<{ file_path: string }> {
    if (!this.arquivos.has(fileId)) throw new Error(`file_id desconhecido no Telegram falso: ${fileId}`);
    this.chamadas.push({ metodo: "obterArquivo", fileId });
    return { file_path: `documents/${fileId}` };
  }

  async baixarArquivo(filePath: string): Promise<Buffer> {
    const fileId = filePath.replace(/^documents\//, "");
    const bytes = this.arquivos.get(fileId);
    if (!bytes) throw new Error(`Caminho desconhecido no Telegram falso: ${filePath}`);
    this.chamadas.push({ metodo: "baixarArquivo", filePath, arquivo: resumo(bytes) });
    return bytes;
  }

  async responderCallback(callbackId: string, texto?: string): Promise<void> {
    this.chamadas.push({ metodo: "responderCallback", callbackId, texto });
  }
}

export class FakePortaLinear implements PortaLinear {
  readonly chamadas: Chamada[] = [];
  private proximoId = 1;

  async criarIssue(e: { titulo: string; descricao: string }): Promise<{ id: string; url: string }> {
    const id = `EM-${this.proximoId++}`;
    const url = `https://linear.app/emvidros/issue/${id}`;
    this.chamadas.push({ metodo: "criarIssue", titulo: e.titulo, descricao: e.descricao, id, url });
    return { id, url };
  }

  async comentar(issueId: string, corpo: string): Promise<void> {
    this.chamadas.push({ metodo: "comentar", issueId, corpo });
  }

  async anexar(issueId: string, bytes: Buffer, nome: string, mediaTipo: string): Promise<{ url: string }> {
    const url = `https://uploads.linear.app/${issueId}/${nome}`;
    this.chamadas.push({ metodo: "anexar", issueId, nome, mediaTipo, arquivo: resumo(bytes), url });
    return { url };
  }

  async moverEstado(issueId: string, estado: string): Promise<void> {
    this.chamadas.push({ metodo: "moverEstado", issueId, estado });
  }
}
