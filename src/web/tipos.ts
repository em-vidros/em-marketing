import type { InferUITools, UIMessage } from "ai";
import type { BotId } from "../agent/bots";
import type { DadosDaEscolha } from "../agent/pedido";
import type { Conversa, ConversaDaEquipe, Pessoa } from "../agent/conversas";
import type { ResumoTarefa, Tarefa } from "../agent/tarefas";
import type { Catalogo, SaidaDelegacao, ToolName } from "../agent/tools";

export type { BotId, Conversa, ConversaDaEquipe, Pessoa, ResumoTarefa, SaidaDelegacao, Tarefa, ToolName };

/** As tools do servidor, como o useChat as vê. Os tipos de entrada e saída vêm das definições. */
export type Ferramentas = InferUITools<Catalogo>;

/** A parte data-referencias leva o que a pessoa marcou e colou para o pedido. */
export type Mensagem = UIMessage<unknown, { referencias: DadosDaEscolha }, Ferramentas>;
export type Parte = Mensagem["parts"][number];

export type ParteDelegacao = Extract<Parte, { type: `tool-delegar_${string}` }>;
export type ParteAprovacao = Extract<Parte, { type: "tool-publicar_agora" | "tool-agendar_publicacao" }>;

/** Quem faz a tarefa: o especialista do nome da tool, ou o bot criado da entrada de delegar_bot, que só existe depois que a entrada chega. */
export const botDaDelegacao = (p: ParteDelegacao): BotId | null =>
  p.type === "tool-delegar_bot" ? (p.input?.botId ?? null) : p.type.slice("tool-delegar_".length);

const MUDAM_A_EQUIPE: ReadonlySet<string> = new Set(["tool-criar_bot", "tool-editar_bot", "tool-remover_bot", "tool-restaurar_bot"]);

/** O Chefe criou, editou, apagou ou restaurou um bot: a barra precisa reler a lista. */
export const mudaAEquipe = (p: Parte) => MUDAM_A_EQUIPE.has(p.type) && "state" in p && p.state === "output-available";

export const ehDelegacao = (p: Parte): p is ParteDelegacao => p.type.startsWith("tool-delegar_");

export const ehAprovacao = (p: Parte): p is ParteAprovacao => p.type === "tool-publicar_agora" || p.type === "tool-agendar_publicacao";

/** GET /api/conversas/:id */
export interface ConversaComMensagens {
  conversa: Conversa;
  /** Quem começou a conversa, quando é outra pessoa (só um admin abre a de outra pessoa). */
  dono: Pessoa | null;
  mensagens: Mensagem[];
}

/** O que cada tool está fazendo e o que fez, para o passo atual e a lista de passos de uma tarefa. */
export const PASSOS: Record<ToolName, { fazendo: string; feito: string }> = {
  produzir_post: { fazendo: "Produzindo o post", feito: "Post produzido" },
  montar_brief: { fazendo: "Montando o brief", feito: "Brief montado" },
  definir_formato: { fazendo: "Definindo o formato", feito: "Formato definido" },
  definir_headline: { fazendo: "Escrevendo a headline", feito: "Headline escrita" },
  gerar_3_artes: { fazendo: "Gerando 3 artes", feito: "3 artes geradas" },
  pesquisar_referencias: { fazendo: "Pesquisando referências", feito: "Referências pesquisadas" },
  pesquisar_web: { fazendo: "Pesquisando na web", feito: "Pesquisa feita" },
  ler_pagina: { fazendo: "Lendo a página", feito: "Página lida" },
  listar_bots: { fazendo: "Olhando a equipe", feito: "Equipe listada" },
  criar_bot: { fazendo: "Criando o bot", feito: "Bot criado" },
  editar_bot: { fazendo: "Editando o bot", feito: "Bot editado" },
  remover_bot: { fazendo: "Removendo o bot", feito: "Bot removido" },
  restaurar_bot: { fazendo: "Restaurando o bot", feito: "Bot restaurado" },
  delegar_bot: { fazendo: "Chamando um bot da equipe", feito: "O bot terminou" },
  mostrar_artes: { fazendo: "Separando as artes", feito: "Artes para escolher" },
  escolher_arte: { fazendo: "Registrando a escolha", feito: "Arte escolhida" },
  buscar_fotos: { fazendo: "Buscando fotos", feito: "Fotos buscadas" },
  usar_foto: { fazendo: "Preparando a foto", feito: "Foto preparada" },
  catalogar_foto: { fazendo: "Catalogando a foto", feito: "Foto catalogada" },
  escrever_legenda: { fazendo: "Escrevendo a legenda", feito: "Legenda escrita" },
  redigir_legenda: { fazendo: "Escrevendo a legenda", feito: "Legenda escrita" },
  validar_texto: { fazendo: "Conferindo o texto", feito: "Texto conferido" },
  derivar_story: { fazendo: "Gerando o story", feito: "Story gerado" },
  listar_agenda: { fazendo: "Lendo a agenda", feito: "Agenda lida" },
  status_do_mes: { fazendo: "Conferindo a cota do mês", feito: "Cota do mês conferida" },
  cancelar_agendamento: { fazendo: "Cancelando o agendamento", feito: "Agendamento cancelado" },
  proximas_datas: { fazendo: "Olhando as próximas datas", feito: "Datas conferidas" },
  roteiro_reel: { fazendo: "Escrevendo o roteiro", feito: "Roteiro escrito" },
  publicar_agora: { fazendo: "Publicando", feito: "Publicado" },
  agendar_publicacao: { fazendo: "Agendando", feito: "Agendado" },
  lembrar: { fazendo: "Guardando na memória", feito: "Guardado na memória" },
  delegar_post: { fazendo: "Chamando o Post", feito: "Post terminou" },
  delegar_legenda: { fazendo: "Chamando o Legenda", feito: "Legenda terminou" },
  delegar_agenda: { fazendo: "Chamando o Agenda", feito: "Agenda terminou" },
  delegar_fotos: { fazendo: "Chamando o Fotos", feito: "Fotos terminou" },
  delegar_reels: { fazendo: "Chamando o Reels", feito: "Reels terminou" },
};

const ehTool = (nome: string): nome is ToolName => Object.hasOwn(PASSOS, nome);

/** Em que pé está uma chamada de tool, do jeito que a interface mostra. */
export type Fase = "fazendo" | "feito" | "falhou" | "esperando" | "recusado";

type ParteDeTool = Extract<UIMessage["parts"][number], { toolCallId: string }>;

/** Cada estado de tool do AI SDK vira uma fase. Prévia (preliminary) ainda é trabalho em andamento. */
const FASE_DA_TOOL: { [E in ParteDeTool["state"]]: (p: Extract<ParteDeTool, { state: E }>) => Fase } = {
  "input-streaming": () => "fazendo",
  "input-available": () => "fazendo",
  "approval-requested": () => "esperando",
  "approval-responded": (p) => (p.approval.approved ? "fazendo" : "recusado"),
  "output-available": (p) => (p.preliminary ? "fazendo" : "feito"),
  "output-error": () => "falhou",
  "output-denied": () => "recusado",
};

export const faseDa = (p: ParteDeTool): Fase => (FASE_DA_TOOL[p.state] as (p: ParteDeTool) => Fase)(p);

const ROTULO_DA_FASE: Record<Fase, (r: { fazendo: string; feito: string }) => string> = {
  fazendo: (r) => r.fazendo,
  feito: (r) => r.feito,
  falhou: (r) => `${r.fazendo}: falhou`,
  esperando: (r) => `${r.fazendo}: esperando você`,
  recusado: (r) => `${r.fazendo}: recusado`,
};

/** O rótulo em português de uma tool, pelo nome da parte (`tool-<nome>`). */
export function rotuloDa(tipo: string, fase: Fase): string {
  const nome = tipo.slice("tool-".length);
  return ROTULO_DA_FASE[fase](ehTool(nome) ? PASSOS[nome] : { fazendo: nome, feito: nome });
}

/** Um passo de tool numa mensagem de especialista, já com o rótulo em português. */
export interface Passo {
  id: string;
  /** O nome da tool, sem o prefixo `tool-`. */
  ferramenta: string;
  rotulo: string;
  estado: Fase;
  /** Um valor curto da entrada, para o chip ao lado do rótulo. */
  detalhe: string | null;
  saida: unknown;
}

/** O primeiro texto curto da entrada de uma tool ("feed", "2026-10"), ou null. */
function detalheDe(entrada: unknown): string | null {
  if (!entrada || typeof entrada !== "object") return null;
  const curto = Object.values(entrada).find((v): v is string | number => (typeof v === "string" && v.length <= 60) || typeof v === "number");
  return curto === undefined ? null : String(curto);
}

/** Os passos de uma mensagem. Mensagem de especialista não é tipada pelo catálogo, então lê pelo nome da parte. */
export function passosDe(m: UIMessage | null | undefined): Passo[] {
  return (m?.parts ?? []).flatMap((p): Passo[] => {
    if (!p.type.startsWith("tool-") || !("toolCallId" in p)) return [];
    const estado = faseDa(p);
    return [
      {
        id: p.toolCallId,
        ferramenta: p.type.slice("tool-".length),
        rotulo: rotuloDa(p.type, estado),
        estado,
        detalhe: "input" in p ? detalheDe(p.input) : null,
        saida: "output" in p ? p.output : undefined,
      },
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
