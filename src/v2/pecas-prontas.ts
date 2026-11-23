import { and, desc, eq, isNull } from "drizzle-orm";
import sharp from "sharp";
import { abrirConversaDoUsuario } from "../agent/conversas";
import { gravarArquivo } from "../armazem";
import { urlDaMidia } from "../db";
import { escreverLegenda } from "../domain/caption";
import type { Problema } from "../domain/brand/validate";
import { PIXELS_MAXIMOS } from "./arquivos";
import { q, type Banco } from "./banco";
import type { Formato } from "./camadas";
import type { Ia } from "./ia";
import { pecasProntas, type PecaPronta } from "./schema";

/** A peça como a tela e o Chefe a veem: a linha e a URL da imagem. */
export type PecaProntaComImagem = PecaPronta & { url: string };

export type RecusaDaPeca = { ok: false; motivo: string };

/** O maior lado que o Instagram usa. Acima disso ele reduz de qualquer jeito. */
const LADO_MAXIMO = 1440;

/**
 * O formato sai da proporção. O feed aceita de 4:5 a 1,91:1; a story é 9:16. Uma folga de 2% cobre
 * os arredondamentos de quem exporta, como 1080×1349. Fora disso o Instagram recusa ou corta.
 */
export function formatoDaProporcao(largura: number, altura: number): Formato | null {
  const r = largura / altura;
  if (r >= 0.8 * 0.98 && r <= 1.91 * 1.02) return "feed";
  if (r >= (9 / 16) * 0.92 && r <= (9 / 16) * 1.08) return "story";
  return null;
}

/**
 * Recebe a imagem que a equipe subiu como peça pronta: converte em JPEG para o Instagram, pede à IA a leitura
 * (texto pintado, tema e pilar) e guarda. A imagem já passou pela checagem de tipo e de tamanho da rota.
 */
export async function receberPecaPronta(
  { banco, ia }: { banco: Banco; ia: Pick<Ia, "lerPecaPronta"> },
  { bytes, criadaPor }: { bytes: Uint8Array; criadaPor: string },
): Promise<{ ok: true; peca: PecaProntaComImagem } | RecusaDaPeca> {
  // O PNG pode ter fundo transparente, que o JPEG não tem; branco é o que o Canva mostra atrás.
  const { data: jpeg, info } = await sharp(bytes, { limitInputPixels: PIXELS_MAXIMOS })
    .rotate()
    .resize(LADO_MAXIMO, LADO_MAXIMO, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#FFFFFF" })
    .jpeg({ quality: 92 })
    .toBuffer({ resolveWithObject: true });
  const formato = formatoDaProporcao(info.width, info.height);
  if (!formato)
    return {
      ok: false,
      motivo: `A peça tem ${info.width}×${info.height} px. O Instagram aceita a proporção do feed, de 4:5 a 1,91:1, como 1080×1350, ou a do story, 9:16, como 1080×1920.`,
    };

  const leitura = await ia.lerPecaPronta(jpeg, "image/jpeg");
  const arquivo = await gravarArquivo("pecas-prontas", `${crypto.randomUUID()}.jpg`, jpeg, "image/jpeg");
  const [criada] = await banco
    .insert(pecasProntas)
    .values({ arquivo, formato, ...leitura, criadaPor })
    .returning();
  return { ok: true, peca: await comImagem(criada!) };
}

const comImagem = async (p: PecaPronta): Promise<PecaProntaComImagem> => ({ ...p, url: await urlDaMidia(p.arquivo) });

/** As peças prontas que não foram removidas, as mais novas primeiro. */
export async function listarPecasProntas(banco: Banco): Promise<PecaProntaComImagem[]> {
  const linhas = await banco.select().from(pecasProntas).where(isNull(pecasProntas.removidaEm)).orderBy(desc(pecasProntas.criadaEm));
  return Promise.all(linhas.map(comImagem));
}

/** Uma peça pronta que não foi removida. */
export async function pegarPecaPronta(banco: Banco, id: string): Promise<PecaProntaComImagem | null> {
  const [p] = await banco
    .select()
    .from(pecasProntas)
    .where(and(eq(pecasProntas.id, id), isNull(pecasProntas.removidaEm)));
  return p ? comImagem(p) : null;
}

const horaDaFila = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

/**
 * Remover só marca a data, para o desfazer trazer de volta. Remover de novo não muda a data.
 * Uma peça na fila não sai: ela sumiria da Biblioteca e ainda seria publicada na hora marcada.
 */
export async function removerPecaPronta(banco: Banco, id: string): Promise<"removida" | "nao-existe" | { agendadaPara: string }> {
  const [existe] = await banco.select({ removidaEm: pecasProntas.removidaEm }).from(pecasProntas).where(eq(pecasProntas.id, id));
  if (!existe) return "nao-existe";
  const [naFila] = await q<{ publish_at: string }>`SELECT publish_at FROM queue WHERE peca_id = ${id} AND status IN ('pending', 'publishing') ORDER BY publish_at LIMIT 1`;
  if (naFila) return { agendadaPara: horaDaFila.format(new Date(`${naFila.publish_at.replace(" ", "T")}Z`)).replace(".", "") };
  if (!existe.removidaEm) await banco.update(pecasProntas).set({ removidaEm: new Date() }).where(eq(pecasProntas.id, id));
  return "removida";
}

export async function restaurarPecaPronta(banco: Banco, id: string): Promise<PecaProntaComImagem | null> {
  const [restaurada] = await banco.update(pecasProntas).set({ removidaEm: null }).where(eq(pecasProntas.id, id)).returning();
  return restaurada ? comImagem(restaurada) : null;
}

/** A legenda que a pessoa revisou no cartão de aprovação. Vazia, a peça sai sem legenda. */
export async function editarLegendaDaPeca(banco: Banco, id: string, legenda: string): Promise<PecaProntaComImagem | null> {
  const [editada] = await banco
    .update(pecasProntas)
    .set({ legenda: legenda.trim() })
    .where(and(eq(pecasProntas.id, id), isNull(pecasProntas.removidaEm)))
    .returning();
  return editada ? comImagem(editada) : null;
}

/**
 * A legenda da peça pelo mesmo gerador dos posts (domain/caption), com o tema e o pilar da leitura e o
 * texto pintado no lugar da headline, com cada bloco separado por barra. Uma peça que já tem legenda fica com ela, salvo com `refazer`.
 */
export async function legendaDaPeca(
  banco: Banco,
  id: string,
  { refazer = false } = {},
): Promise<{ ok: true; peca: PecaProntaComImagem; problemas: Problema[] } | RecusaDaPeca> {
  const peca = await pegarPecaPronta(banco, id);
  if (!peca) return { ok: false, motivo: "Peça pronta não encontrada. Chame listar_pecas_prontas para ver as que existem." };
  if (peca.formato === "story") return { ok: false, motivo: "Peça de story não leva legenda: o Instagram não mostra legenda em story." };
  if (peca.legenda && !refazer) return { ok: true, peca, problemas: [] };

  const { legenda, problemas } = await escreverLegenda({ pilar: peca.pilar, tema: peca.tema, precisaFotoReal: false }, peca.texto.replace(/\n+/g, " / "));
  const gravada = await editarLegendaDaPeca(banco, id, legenda);
  return gravada ? { ok: true, peca: gravada, problemas } : { ok: false, motivo: "A peça foi removida enquanto a legenda era escrita." };
}

/**
 * O pedido que a Biblioteca manda ao Chefe para publicar ou agendar a peça. O começo do id basta para o Chefe
 * achar a peça em listar_pecas_prontas quando duas têm o mesmo tema, sem encher a mensagem.
 */
export function pedidoDaPeca(p: Pick<PecaPronta, "id" | "tema" | "formato">): string {
  const legenda = p.formato === "feed" ? "Escreva a legenda e me pergunte" : "Me pergunte";
  return `Quero publicar a peça pronta "${p.tema}" (id ${p.id.slice(0, 8)}), do ${p.formato}. ${legenda} se publico agora ou quando agendar.`;
}

/** Uma conversa nova com o Chefe para publicar a peça. A tela manda `pedido` como primeira mensagem. */
export async function conversaDaPeca(banco: Banco, userId: string, id: string): Promise<{ conversaId: string; pedido: string } | null> {
  const peca = await pegarPecaPronta(banco, id);
  if (!peca) return null;
  const conversaId = crypto.randomUUID();
  await abrirConversaDoUsuario(userId, conversaId, "chefe", `Publicar ${peca.tema}`.slice(0, 80));
  return { conversaId, pedido: pedidoDaPeca(peca) };
}
