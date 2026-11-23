import { tool } from "ai";
import { z } from "zod";
import { criarArteComCampos, PedidoInvalido, type Estudio } from "../../v2/artes";
import { PedidoDeArte, TIPOS_DE_ARTE } from "../../v2/campos";
import type { Arte } from "../../v2/schema";
import type { ReferenciasDoTurno } from "../pedido";

const formato = z.enum(["feed", "story"]).optional().describe("feed é o padrão. Story só quando a pessoa pedir story.");

const campo = (tipo: keyof typeof TIPOS_DE_ARTE, nome: string, quando: string) => {
  const c = TIPOS_DE_ARTE[tipo].campos.find((x) => x.nome === nome)!;
  return z.string().optional().describe(`${quando} Até ${c.max} letras. Exemplo: "${c.exemplo}". Omita se a pessoa não disse.`);
};

const SEM_ESTUDIO = { ok: false as const, motivo: "O estúdio de artes não está ligado neste servidor." };

/** O que o cartão da conversa mostra: a arte criada, o PNG como está agora e o texto de cada camada. */
const resultado = (arte: Arte) => ({
  ok: true as const,
  arteId: arte.id,
  formato: arte.formato,
  url: `/api/artes/${arte.id}/png?v=${arte.atualizadaEm.getTime()}`,
  editor: `/artes/${arte.id}`,
  textos: arte.camadas.flatMap((c) => (c.tipo === "texto" ? [c.texto] : [])),
});

async function criar(estudio: Estudio | undefined, autor: string, pedido: unknown, formato: "feed" | "story" | undefined) {
  if (!estudio) return SEM_ESTUDIO;
  const lido = PedidoDeArte.safeParse(pedido);
  if (!lido.success) return { ok: false as const, motivo: lido.error.issues[0]?.message ?? "Pedido inválido." };
  try {
    return resultado(await criarArteComCampos(estudio, { ...lido.data, formato: formato ?? "feed", criadaPor: autor }));
  } catch (e) {
    if (e instanceof PedidoInvalido) return { ok: false as const, motivo: e.message };
    throw e;
  }
}

/**
 * Convite e aniversário: o modelo de imagem gera só a cena e o texto entra por código, como a pessoa escreveu.
 * As duas tools chamam criarArteComCampos, a mesma função da rota POST /api/artes.
 */
export function toolsDeArtesComTexto({ estudio, autor, referencias }: { estudio?: Estudio; autor: string; referencias?: ReferenciasDoTurno }) {
  return {
    criar_convite: tool({
      description:
        "Cria um convite no estúdio de artes e devolve a arte pronta para a pessoa ajustar no editor. O texto de cada campo e o logo entram por código, exatamente como você mandar: nunca reescreva, resuma nem corrija o que a pessoa disse. Campo que ela não disse fica de fora, e não invente data, hora nem local. Não precisa de brief nem de escolha entre variações.",
      inputSchema: z.object({
        titulo: campo("convite", "titulo", "A frase de chamada do convite."),
        evento: campo("convite", "evento", "O nome do evento."),
        data: campo("convite", "data", "A data do evento, como a pessoa escreveu."),
        hora: campo("convite", "hora", "O horário, como a pessoa escreveu."),
        local: campo("convite", "local", "O endereço ou a unidade."),
        observacao: campo("convite", "observacao", "Uma observação curta, opcional."),
        formato,
      }),
      execute: ({ formato, ...campos }) => criar(estudio, autor, { tipo: "convite", campos }, formato),
    }),

    criar_aniversario: tool({
      description:
        "Cria a arte de aniversário de um cliente, parceiro ou colaborador no estúdio de artes e devolve a arte pronta para ajustar no editor. O nome e a mensagem entram por código, exatamente como você mandar. Se a pessoa não disse a mensagem, escreva uma frase curta e calorosa, sem ponto de exclamação. Com foto_colada, a imagem que ela colou neste pedido vira a foto do aniversariante, em círculo.",
      inputSchema: z.object({
        nome: campo("aniversario", "nome", "O nome de quem faz aniversário."),
        mensagem: campo("aniversario", "mensagem", "A mensagem curta da arte."),
        foto_colada: z.boolean().optional().describe("true quando a pessoa colou uma foto neste pedido para ser a foto do aniversariante."),
        formato,
      }),
      execute: async ({ foto_colada, formato, ...campos }) => {
        const foto = foto_colada ? referencias?.coladas[0] : undefined;
        if (foto_colada && !foto) return { ok: false as const, motivo: "Não chegou nenhuma foto neste pedido. Peça para a pessoa colar a foto e peça de novo." };
        const resposta = await criar(estudio, autor, { tipo: "aniversario", campos: { ...campos, foto } }, formato);
        // A foto serviu à arte de aniversário: a próxima geração de posts não a usa como referência de estilo.
        if (resposta.ok && foto) referencias?.usar([{ origem: "pedido", arquivo: foto }]);
        return resposta;
      },
    }),
  };
}
