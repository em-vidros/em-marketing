import type { InferUITools, UIDataTypes, UIMessage } from "ai";
import type { BotId, Especialista } from "../agent/bots";
import type { Conversa } from "../agent/conversas";
import type { ResumoTarefa, Tarefa } from "../agent/tarefas";
import type { catalogo, SaidaDelegacao, ToolName } from "../agent/tools";

export type { BotId, Conversa, Especialista, ResumoTarefa, SaidaDelegacao, Tarefa, ToolName };

/** As tools do servidor, como o useChat as vê. Os tipos de entrada e saída vêm das definições. */
export type Ferramentas = InferUITools<ReturnType<typeof catalogo>>;

export type Mensagem = UIMessage<unknown, UIDataTypes, Ferramentas>;
export type Parte = Mensagem["parts"][number];

export type ParteDelegacao = Extract<Parte, { type: `tool-delegar_${Especialista}` }>;
export type ParteAprovacao = Extract<Parte, { type: "tool-publicar_agora" | "tool-agendar_publicacao" }>;

export const especialistaDa = (p: ParteDelegacao) => p.type.slice("tool-delegar_".length) as Especialista;

export const ehDelegacao = (p: Parte): p is ParteDelegacao => p.type.startsWith("tool-delegar_");

export const ehAprovacao = (p: Parte): p is ParteAprovacao => p.type === "tool-publicar_agora" || p.type === "tool-agendar_publicacao";

/** GET /api/conversas/:id */
export interface ConversaComMensagens {
  conversa: Conversa;
  mensagens: Mensagem[];
}

/** O que cada tool está fazendo e o que fez, para o passo atual e a lista de passos de uma tarefa. */
export const PASSOS: Record<ToolName, { fazendo: string; feito: string }> = {
  montar_brief: { fazendo: "Montando o brief", feito: "Brief montado" },
  definir_formato: { fazendo: "Definindo o formato", feito: "Formato definido" },
  definir_headline: { fazendo: "Escrevendo a headline", feito: "Headline escrita" },
  gerar_3_artes: { fazendo: "Gerando 3 artes", feito: "3 artes geradas" },
  escolher_arte: { fazendo: "Registrando a escolha", feito: "Arte escolhida" },
  buscar_fotos: { fazendo: "Buscando fotos", feito: "Fotos buscadas" },
  usar_foto: { fazendo: "Preparando a foto", feito: "Foto preparada" },
  catalogar_foto: { fazendo: "Catalogando a foto", feito: "Foto catalogada" },
  escrever_legenda: { fazendo: "Escrevendo a legenda", feito: "Legenda escrita" },
  redigir_legenda: { fazendo: "Escrevendo a legenda", feito: "Legenda escrita" },
  validar_texto: { fazendo: "Conferindo o texto", feito: "Texto conferido" },
  derivar_story: { fazendo: "Gerando o story", feito: "Story gerado" },
  salvar_linear: { fazendo: "Registrando no Linear", feito: "Registrado no Linear" },
  listar_agenda: { fazendo: "Lendo a agenda", feito: "Agenda lida" },
  status_do_mes: { fazendo: "Conferindo a cota do mês", feito: "Cota do mês conferida" },
  cancelar_agendamento: { fazendo: "Cancelando o agendamento", feito: "Agendamento cancelado" },
  proximas_datas: { fazendo: "Olhando as próximas datas", feito: "Datas conferidas" },
  roteiro_reel: { fazendo: "Escrevendo o roteiro", feito: "Roteiro escrito" },
  publicar_agora: { fazendo: "Publicando", feito: "Publicado" },
  agendar_publicacao: { fazendo: "Agendando", feito: "Agendado" },
  delegar_post: { fazendo: "Chamando o Post", feito: "Post terminou" },
  delegar_legenda: { fazendo: "Chamando o Legenda", feito: "Legenda terminou" },
  delegar_agenda: { fazendo: "Chamando o Agenda", feito: "Agenda terminou" },
  delegar_fotos: { fazendo: "Chamando o Fotos", feito: "Fotos terminou" },
  delegar_reels: { fazendo: "Chamando o Reels", feito: "Reels terminou" },
};

const ehTool = (nome: string): nome is ToolName => Object.hasOwn(PASSOS, nome);

/** Um passo de tool numa mensagem de especialista, já com o rótulo em português. */
export interface Passo {
  id: string;
  rotulo: string;
  estado: "fazendo" | "feito" | "falhou";
  saida: unknown;
}

/** Os passos de uma mensagem. Mensagem de especialista não é tipada pelo catálogo, então lê pelo nome da parte. */
export function passosDe(m: UIMessage | null | undefined): Passo[] {
  return (m?.parts ?? []).flatMap((p): Passo[] => {
    if (!p.type.startsWith("tool-") || !("toolCallId" in p) || !("state" in p)) return [];
    const nome = p.type.slice(5);
    const rotulo = ehTool(nome) ? PASSOS[nome] : { fazendo: nome, feito: nome };
    const estado = p.state === "output-error" ? "falhou" : p.state === "output-available" && !p.preliminary ? "feito" : "fazendo";
    return [
      { id: p.toolCallId, rotulo: estado === "feito" ? rotulo.feito : rotulo.fazendo, estado, saida: "output" in p ? p.output : undefined },
    ];
  });
}

/** URLs /media/:id dentro da saída de uma tool, em qualquer profundidade. */
export function imagensEm(saida: unknown): string[] {
  const achadas = new Set<string>();
  const visitar = (v: unknown) => {
    if (typeof v === "string") for (const m of v.matchAll(/\/media\/[A-Za-z0-9_-]+/g)) achadas.add(m[0]);
    else if (Array.isArray(v)) v.forEach(visitar);
    else if (v && typeof v === "object") Object.values(v).forEach(visitar);
  };
  visitar(saida);
  return [...achadas];
}
