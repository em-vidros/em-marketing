import { z } from "zod";
import { NOME_DE_FAMILIA, PESOS } from "./fontes";

/** Tamanho final de publicação e a área segura de cada formato (tokens.json, `formats`). */
export const FORMATOS = {
  feed: { largura: 1080, altura: 1350, topo: 80, base: 80 },
  story: { largura: 1080, altura: 1920, topo: 250, base: 340 },
} as const;

export type Formato = keyof typeof FORMATOS;

const MARGEM = 80;

/** Altura sobre largura do logo oficial (viewBox 2272×1888). */
export const PROPORCAO_DO_LOGO = 1888 / 2272;

const cor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "A cor precisa ser um hex como #2F646A.");
const px = z.number().int().min(-2000).max(4000);
const id = z.string().min(1).max(40);

/** Os limites do schema que o editor também respeita, para nunca gerar uma camada que o PUT recusa. */
export const LIMITES = {
  posicao: [-2000, 4000],
  largura: { texto: [20, 4000], logo: [40, 1080], imagem: [20, 4000], forma: [1, 4000] },
  altura: [1, 4000],
  caracteres: 400,
} as const;

/**
 * O que toda camada tem além do tipo. Rotação gira em graus em torno do centro, e x e y continuam sendo o canto
 * da caixa sem giro. Os dois são opcionais porque as artes gravadas antes deles não os têm; `transformacaoDa` dá o valor em vigor.
 * `bloqueada` só vale no editor, que não deixa mexer na camada; o PNG a desenha igual.
 */
const comum = {
  id,
  x: px,
  y: px,
  rotacao: z.number().min(-360).max(360).optional(),
  opacidade: z.number().min(0).max(1).optional(),
  bloqueada: z.boolean().optional(),
};

/** `fonte` é uma família do Google Fonts; a API confere no catálogo se ela existe e tem o peso, porque o catálogo muda. */
const Texto = z.object({
  ...comum,
  tipo: z.literal("texto"),
  texto: z.string().min(1, "O texto não pode ficar vazio.").max(LIMITES.caracteres),
  fonte: z.string().max(60).regex(NOME_DE_FAMILIA, "Nome de fonte inválido."),
  peso: z.literal(PESOS, "O peso vai de 100 a 900, de 100 em 100."),
  tamanho: z.number().int().min(12).max(400),
  entrelinha: z.number().min(0.8).max(2.5),
  cor,
  alinhamento: z.enum(["esquerda", "centro", "direita"]),
  largura: z.number().int().min(LIMITES.largura.texto[0]).max(LIMITES.largura.texto[1]),
});

const Logo = z.object({ ...comum, tipo: z.literal("logo"), variante: z.enum(["cor", "branca"]), largura: z.number().int().min(LIMITES.largura.logo[0]).max(LIMITES.largura.logo[1]) });

/** Imagem ou SVG enviado pelo usuário, guardado como PNG. `proporcao` é altura sobre largura. */
const Imagem = z.object({
  ...comum,
  tipo: z.literal("imagem"),
  chave: z.string().regex(/^[0-9a-f-]{36}\.(png|jpg|webp)$/, "Arquivo de imagem inválido."),
  proporcao: z.number().positive().max(20),
  largura: z.number().int().min(LIMITES.largura.imagem[0]).max(LIMITES.largura.imagem[1]),
});

const Forma = z.object({
  ...comum,
  tipo: z.literal("forma"),
  cor,
  largura: z.number().int().min(LIMITES.largura.forma[0]).max(LIMITES.largura.forma[1]),
  altura: z.number().int().min(LIMITES.altura[0]).max(LIMITES.altura[1]),
  raio: z.number().int().min(0).max(12),
});

/** A ordem do array é a ordem de empilhamento: a primeira camada fica logo acima da cena. */
export const Camadas = z.array(z.union([Texto, Logo, Imagem, Forma])).max(30, "Uma arte tem no máximo 30 camadas.");
export type Camada = z.infer<typeof Camadas>[number];

const limitar = (v: number, [minimo, maximo]: readonly [number, number]) => Math.min(maximo, Math.max(minimo, Math.round(v)));

/** Prende posição, tamanho e texto aos limites do schema. */
export function dentroDosLimites(camada: Camada): Camada {
  const base = { ...camada, x: limitar(camada.x, LIMITES.posicao), y: limitar(camada.y, LIMITES.posicao), largura: limitar(camada.largura, LIMITES.largura[camada.tipo]) };
  switch (base.tipo) {
    case "texto":
      return { ...base, texto: base.texto.slice(0, LIMITES.caracteres) };
    case "forma":
      return { ...base, altura: limitar(base.altura, LIMITES.altura) };
    default:
      return base;
  }
}

export const transformacaoDa = (camada: Camada) => ({ rotacao: camada.rotacao ?? 0, opacidade: camada.opacidade ?? 1 });

/**
 * O tratamento da cena. Brilho, contraste e saturação são multiplicadores, 1 é neutro; desfoque é o raio em px da arte.
 * O enquadramento amplia a cena em `zoom` vezes e põe no centro da arte o ponto `focoX`, `focoY` (fração da cena, 0,5 é o meio).
 */
export const Ajustes = z.object({
  brilho: z.number().min(0.5).max(1.5),
  contraste: z.number().min(0.5).max(1.5),
  saturacao: z.number().min(0).max(2),
  desfoque: z.number().min(0).max(30),
  zoom: z.number().min(1).max(3),
  focoX: z.number().min(0).max(1),
  focoY: z.number().min(0).max(1),
});

export type Ajustes = z.infer<typeof Ajustes>;

export const AJUSTES_NEUTROS: Ajustes = { brilho: 1, contraste: 1, saturacao: 1, desfoque: 0, zoom: 1, focoX: 0.5, focoY: 0.5 };

/** O retângulo da cena, em px da imagem original, que o enquadramento estica sobre a arte inteira. */
export function recorteDaCena({ zoom, focoX, focoY }: Ajustes, largura: number, altura: number) {
  const janela = { largura: Math.round(largura / zoom), altura: Math.round(altura / zoom) };
  const centro = (foco: number, total: number, lado: number) => Math.round(Math.min(total - lado, Math.max(0, foco * total - lado / 2)));

  return { left: centro(focoX, largura, janela.largura), top: centro(focoY, altura, janela.altura), width: janela.largura, height: janela.altura };
}

/** O que o modelo de texto devolve para montar uma arte nova. A cena vai sozinha para o modelo de imagem. */
export const Plano = z.object({
  cena: z.string().describe("Prompt em inglês para o modelo de imagem. Só a cena, sem texto e sem logo."),
  titulo: z.string().describe("Título da arte em PT-BR, até 8 palavras."),
  apoio: z.string().nullable().describe("Uma frase de apoio em PT-BR, ou null."),
  display: z.boolean().describe("true só para pilar MARCA ou GENTE, quando o título pede Playfair Display."),
  fundoEscuro: z.boolean().describe("true se a parte de cima da cena for escura e o texto precisar ser branco."),
});
export type Plano = z.infer<typeof Plano>;

/** Largura média de um caractere, em fração do tamanho da fonte. Só serve para estimar a quebra de linha. */
const LARGURA_MEDIA = new Map([
  ["Poppins", 0.56],
  ["Playfair Display", 0.5],
]);

const LARGURA_MEDIA_GENERICA = 0.55;

/** Quantas linhas o texto ocupa, quebrando por palavra como o render faz. É estimativa: o render mede a fonte de verdade. */
export function linhasEstimadas(texto: string, fonte: string, tamanho: number, largura: number): number {
  const porLinha = Math.max(1, Math.floor(largura / (tamanho * (LARGURA_MEDIA.get(fonte) ?? LARGURA_MEDIA_GENERICA))));
  let linhas = 1;
  let ocupado = 0;
  for (const palavra of texto.split(/\s+/)) {
    const extra = ocupado === 0 ? palavra.length : palavra.length + 1;
    if (ocupado + extra > porLinha && ocupado > 0) {
      linhas += 1;
      ocupado = palavra.length;
    } else ocupado += extra;
  }
  return linhas;
}

/** As camadas de partida: título e apoio alinhados à esquerda no topo, logo no canto inferior direito. */
export function camadasIniciais(formato: Formato, plano: Plano): Camada[] {
  const { largura, altura, topo, base } = FORMATOS[formato];
  const escala = formato === "story" ? 1.15 : 1;
  const corDoTexto = plano.fundoEscuro ? "#FFFFFF" : "#2F646A";
  const tamanhoTitulo = Math.round((plano.display ? 104 : 76) * escala);
  const larguraTexto = largura - 2 * MARGEM;
  const larguraLogo = Math.round(largura * 0.14);
  const titulo: Camada = {
    id: "titulo",
    tipo: "texto",
    texto: plano.titulo,
    fonte: plano.display ? "Playfair Display" : "Poppins",
    peso: plano.display ? 500 : 600,
    tamanho: tamanhoTitulo,
    entrelinha: plano.display ? 1.05 : 1.1,
    cor: corDoTexto,
    alinhamento: "esquerda",
    x: MARGEM,
    y: topo,
    largura: larguraTexto,
  };
  const apoio: Camada[] = plano.apoio
    ? [
        {
          id: "apoio",
          tipo: "texto",
          texto: plano.apoio,
          fonte: "Poppins",
          peso: 500,
          tamanho: Math.round(40 * escala),
          entrelinha: 1.3,
          cor: plano.fundoEscuro ? "#FFFFFF" : "#414141",
          alinhamento: "esquerda",
          x: MARGEM,
          y: topo + Math.round(titulo.tamanho * titulo.entrelinha * linhasEstimadas(titulo.texto, titulo.fonte, titulo.tamanho, titulo.largura)) + 40,
          largura: larguraTexto,
        },
      ]
    : [];
  const logo: Camada = {
    id: "logo",
    tipo: "logo",
    variante: plano.fundoEscuro ? "branca" : "cor",
    x: largura - MARGEM - larguraLogo,
    y: altura - base - Math.round(larguraLogo * PROPORCAO_DO_LOGO),
    largura: larguraLogo,
  };
  return [titulo, ...apoio, logo];
}
