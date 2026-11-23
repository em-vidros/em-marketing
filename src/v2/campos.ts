import { z } from "zod";
import { camadaDoLogo, FORMATOS, linhasEstimadas, MARGEM, type Camada, type Formato } from "./camadas";

/**
 * Os tipos de arte em que o texto entra por código: convite e aniversário. O modelo de imagem gera só a cena,
 * e cada campo vira uma camada com o texto exatamente como a pessoa escreveu. Campo vazio não vira camada.
 * Este arquivo roda no servidor e no navegador, então não importa banco, sharp nem arquivos.
 */

/** Os tetos deixam o convite inteiro, com todos os campos cheios, acima do logo no feed e no story. */
const MAX = { titulo: 48, evento: 48, data: 32, hora: 30, local: 80, observacao: 100, nome: 40, mensagem: 100 } as const;

export type CampoDoTipo = { nome: string; rotulo: string; exemplo: string; max: number; opcional?: true; linhas?: number };

export const TIPOS_DE_ARTE = {
  convite: {
    rotulo: "Convite",
    campos: [
      { nome: "titulo", rotulo: "Título", exemplo: "Você é nosso convidado especial", max: MAX.titulo },
      { nome: "evento", rotulo: "Evento", exemplo: "Café da manhã especial", max: MAX.evento },
      { nome: "data", rotulo: "Data", exemplo: "28 de novembro", max: MAX.data },
      { nome: "hora", rotulo: "Hora", exemplo: "A partir das 8h", max: MAX.hora },
      { nome: "local", rotulo: "Local", exemplo: "Imperatriz", max: MAX.local },
      { nome: "observacao", rotulo: "Observação", exemplo: "Confirme presença com seu vendedor", max: MAX.observacao, opcional: true, linhas: 2 },
    ],
  },
  aniversario: {
    rotulo: "Aniversário",
    campos: [
      { nome: "nome", rotulo: "Nome", exemplo: "Ana Paula", max: MAX.nome },
      { nome: "mensagem", rotulo: "Mensagem curta", exemplo: "Feliz aniversário. Obrigado por construir a EM Vidros com a gente.", max: MAX.mensagem, linhas: 2 },
    ],
  },
} as const satisfies Record<string, { rotulo: string; campos: readonly CampoDoTipo[] }>;

export type TipoDeArte = keyof typeof TIPOS_DE_ARTE;
export const TIPOS = Object.keys(TIPOS_DE_ARTE) as [TipoDeArte, ...TipoDeArte[]];

/** Espaço e quebra de linha repetidos viram um espaço só: o render quebra a linha pela largura, não pelo que foi digitado. */
const limpo = (s: string) => s.replace(/\s+/g, " ").trim();

/** Um campo de texto. Ausente, nulo e vazio dão a mesma coisa: "", e o campo não aparece na arte. */
const campo = (max: number) =>
  z
    .string()
    .max(max * 3, "O texto é grande demais.")
    .nullish()
    .transform((v) => limpo(v ?? ""))
    .pipe(z.string().max(max, `Passa de ${max} letras.`));

const algumPreenchido = (c: Record<string, string | undefined>) => Object.values(c).some(Boolean);
const SEM_NADA = "Preencha ao menos um campo.";

export const CamposDoConvite = z
  .object({
    titulo: campo(MAX.titulo),
    evento: campo(MAX.evento),
    data: campo(MAX.data),
    hora: campo(MAX.hora),
    local: campo(MAX.local),
    observacao: campo(MAX.observacao),
  })
  .refine(algumPreenchido, SEM_NADA);

/** `foto` é a chave de um arquivo já subido (POST /api/arquivos). Na arte, a foto vira um círculo. */
export const CamposDoAniversario = z
  .object({
    nome: campo(MAX.nome),
    mensagem: campo(MAX.mensagem),
    foto: z
      .string()
      .regex(/^[0-9a-f-]{36}\.(png|jpg|webp)$/, "Arquivo de imagem inválido.")
      .nullish()
      .transform((v) => v ?? undefined),
  })
  .refine(algumPreenchido, SEM_NADA);

export type Convite = z.output<typeof CamposDoConvite>;
export type Aniversario = z.output<typeof CamposDoAniversario>;

export const PedidoDeArte = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("convite"), campos: CamposDoConvite }),
  z.object({ tipo: z.literal("aniversario"), campos: CamposDoAniversario }),
]);
export type PedidoDeArte = z.output<typeof PedidoDeArte>;

/** O que fica gravado em `artes.pedido`: os campos de texto, na ordem da arte. */
export function pedidoEmTexto(p: PedidoDeArte): string {
  const partes = p.tipo === "convite" ? [p.campos.titulo, p.campos.evento, p.campos.data, p.campos.hora, p.campos.local] : [p.campos.nome, p.campos.mensagem];
  return `${TIPOS_DE_ARTE[p.tipo].rotulo}: ${partes.filter(Boolean).join(", ") || "só a foto"}`.slice(0, 1000);
}

/**
 * O que o planejador da cena lê. Só o tema, nunca nome, data nem endereço: o texto da arte não passa pelo modelo,
 * e o prompt da cena não tem como pintar o que não recebeu.
 */
export function temaDaCena(p: PedidoDeArte): string {
  const fim = "Só a cena de fundo; o texto entra depois, por código.";
  if (p.tipo === "convite") return `Convite para ${p.campos.evento || p.campos.titulo || "um evento da EM Vidros"}. ${fim}`;
  return `Cartão de aniversário da equipe da EM Vidros: festivo e acolhedor, abstrato, sem pessoas. ${fim}`;
}

type Texto = Extract<Camada, { tipo: "texto" }>;
type Estilo = Pick<Texto, "fonte" | "peso" | "tamanho" | "entrelinha" | "cor" | "alinhamento">;
type Item = readonly [id: string, conteudo: string | undefined, estilo: Estilo];

const TEAL = "#2F646A";
const GRAFITE = "#414141";
const BRANCO = "#FFFFFF";
const AREIA = "#E4E1D8";

const alturaDe = (t: Texto) => Math.round(t.tamanho * t.entrelinha * linhasEstimadas(t.texto, t.fonte, t.tamanho, t.largura));

/** Empilha de cima para baixo os itens com texto, pulando os vazios. `fim` é o y logo abaixo do último. */
function empilhar(itens: readonly Item[], { x, largura, topo, folga }: { x: number; largura: number; topo: number; folga: (anterior: string) => number }) {
  const camadas: Texto[] = [];
  let y = topo;
  for (const [id, conteudo, estilo] of itens) {
    if (!conteudo) continue;
    const anterior = camadas.at(-1);
    if (anterior) y += folga(anterior.id);
    const camada: Texto = { id, tipo: "texto", texto: conteudo, ...estilo, x, y, largura };
    camadas.push(camada);
    y += alturaDe(camada);
  }
  return { camadas, fim: y };
}

const tamanhoDoTitulo = (s: string) => (s.length <= 28 ? 96 : s.length <= 44 ? 80 : 64);
const tamanhoDoNome = (s: string) => (s.length <= 14 ? 128 : s.length <= 24 ? 104 : 80);

const escalaDe = (formato: Formato) => {
  const e = formato === "story" ? 1.15 : 1;
  return (n: number) => Math.round(n * e);
};

const poppins = (peso: 400 | 500 | 600, tamanho: number, entrelinha: number, cor: string, alinhamento: Estilo["alinhamento"] = "esquerda"): Estilo => ({
  fonte: "Poppins",
  peso,
  tamanho,
  entrelinha,
  cor,
  alinhamento,
});

const playfair = (tamanho: number, cor: string, alinhamento: Estilo["alinhamento"]): Estilo => ({ fonte: "Playfair Display", peso: 500, tamanho, entrelinha: 1.05, cor, alinhamento });

/**
 * Título e evento no topo, no off-white liso que a cena deixa, e os detalhes num cartão de areia: data, hora, local e
 * observação ficam legíveis em qualquer cena. O logo vem por último, no canto da marca.
 */
export function camadasDoConvite(formato: Formato, c: Convite, { fundoEscuro }: { fundoEscuro: boolean }): Camada[] {
  const { largura, topo } = FORMATOS[formato];
  const px = escalaDe(formato);
  const larguraTexto = largura - 2 * MARGEM;
  const cabecalho = fundoEscuro ? BRANCO : TEAL;

  const alto = empilhar(
    [
      ["titulo", c.titulo, playfair(px(tamanhoDoTitulo(c.titulo)), cabecalho, "esquerda")],
      ["evento", c.evento, poppins(600, px(52), 1.15, cabecalho)],
    ],
    { x: MARGEM, largura: larguraTexto, topo, folga: () => px(24) },
  );

  const recuo = 48;
  const cartaoTopo = alto.camadas.length > 0 ? alto.fim + px(56) : topo;
  const miolo = empilhar(
    [
      ["data", c.data, poppins(600, px(46), 1.2, GRAFITE)],
      ["hora", c.hora, poppins(600, px(46), 1.2, GRAFITE)],
      ["local", c.local, poppins(400, px(38), 1.3, GRAFITE)],
      ["observacao", c.observacao, poppins(400, px(30), 1.5, GRAFITE)],
    ],
    { x: MARGEM + recuo, largura: larguraTexto - 2 * recuo, topo: cartaoTopo + px(44), folga: (anterior) => px(anterior === "local" ? 22 : 12) },
  );
  const cartao: Camada[] =
    miolo.camadas.length > 0 ? [{ id: "cartao", tipo: "forma", cor: AREIA, x: MARGEM, y: cartaoTopo, largura: larguraTexto, altura: miolo.fim + px(44) - cartaoTopo, raio: 12 }] : [];

  return [...cartao, ...alto.camadas, ...miolo.camadas, camadaDoLogo(formato, fundoEscuro)];
}

/** O diâmetro da foto de aniversário, em px da arte. */
export const diametroDaFoto = (formato: Formato) => Math.round(escalaDe(formato)(420) / 2) * 2;

/**
 * Nome em Playfair e mensagem em Poppins, centralizados no topo, e a foto em círculo abaixo. `foto` é a chave do PNG
 * já recortado em círculo (src/v2/foto.ts). Sem foto, o espaço fica para a cena.
 */
export function camadasDoAniversario(formato: Formato, c: Aniversario, { fundoEscuro, foto }: { fundoEscuro: boolean; foto?: string }): Camada[] {
  const { largura, topo } = FORMATOS[formato];
  const px = escalaDe(formato);
  const cabecalho = fundoEscuro ? BRANCO : TEAL;
  const recuo = 80;

  const nome = empilhar([["nome", c.nome, playfair(px(tamanhoDoNome(c.nome)), cabecalho, "centro")]], { x: MARGEM, largura: largura - 2 * MARGEM, topo, folga: () => 0 });
  // A mensagem é mais estreita que o nome, para a frase não encostar nas bordas.
  const mensagem = empilhar([["mensagem", c.mensagem, poppins(500, px(44), 1.3, fundoEscuro ? BRANCO : GRAFITE, "centro")]], {
    x: MARGEM + recuo,
    largura: largura - 2 * (MARGEM + recuo),
    topo: nome.camadas.length > 0 ? nome.fim + px(28) : topo,
    folga: () => 0,
  });
  const camadas = [...nome.camadas, ...mensagem.camadas];
  const fimDoTexto = mensagem.camadas.length > 0 ? mensagem.fim : nome.fim;

  const d = diametroDaFoto(formato);
  const circulo: Camada[] = foto
    ? [{ id: "foto", tipo: "imagem", chave: foto, proporcao: 1, x: Math.round((largura - d) / 2), y: camadas.length > 0 ? fimDoTexto + px(56) : topo, largura: d }]
    : [];

  return [...circulo, ...camadas, camadaDoLogo(formato, fundoEscuro)];
}

export const camadasDaArte = (p: PedidoDeArte, formato: Formato, o: { fundoEscuro: boolean; foto?: string }): Camada[] =>
  p.tipo === "convite" ? camadasDoConvite(formato, p.campos, o) : camadasDoAniversario(formato, p.campos, o);
