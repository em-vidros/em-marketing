/**
 * Máquina de estado da conversa por chat. O que acontece antes de existir fluxo,
 * e o texto do ajuste depois do botão, moram aqui; tudo que muda um fluxo passa
 * pelo EntradaTelegram, que é quem escreve no banco.
 *
 * A tabela é total: toda combinação de etapa e classe de evento tem uma célula,
 * e classe nova sem célula não compila. Espalhar isso em `if` foi o que fez o bot
 * v1 responder duas coisas diferentes para a mesma mensagem.
 *
 * O update é dado externo (PRD §4.11): `narrar` lê só os campos que usamos e
 * devolve null para qualquer outra coisa, sem lançar. Atualizações do mesmo chat
 * rodam em série, senão dois toques rápidos leem o mesmo estado e um sobrescreve
 * o outro.
 */

import type { PortaTelegram } from "../adaptadores/tipos";
import type { EntradaTelegram, ResultadoValidacao } from "../controle/api";
import type { Callback } from "../controle/aprovacoes";
import { codificar, decodificar } from "../controle/aprovacoes";
import type { Fluxo } from "../controle/fluxos";
import { ID_RE } from "../controle/ids";
import { ESPERA } from "../controle/revisoes";
import type {
  EstadoConversa,
  EstadoQualquer,
  FluxoId,
  FormatoPedido,
  Pedido,
  RevisaoPendente,
} from "../modelos/tipos";
import { arestaLegal } from "../modelos/tipos";

interface Botao {
  text: string;
  callback_data: string;
}

const FORMATOS: readonly { valor: FormatoPedido; rotulo: string }[] = [
  { valor: "feed", rotulo: "Feed" },
  { valor: "stories", rotulo: "Stories" },
  { valor: "both", rotulo: "Os dois" },
];

const ROTULO_FORMATO: Record<FormatoPedido, string> = {
  feed: "Feed",
  stories: "Stories",
  both: "Feed e Stories",
  blog: "Blog",
};

/** Estado do fluxo em palavras de gente. Sem `default`: estado novo no alfabeto para o build. */
const ESTADO_EM_PALAVRAS: Record<EstadoQualquer, string> = {
  requested: "Esperando você confirmar o brief.",
  brief_confirmed: "Montando três direções criativas.",
  directions_ready: "Direções prontas, começando as artes.",
  prototypes_generating: "Gerando as prévias.",
  prototype_qa: "Conferindo as prévias no controle de qualidade.",
  awaiting_prototype_review: "Esperando sua revisão das três prévias.",
  adjustment_requested: "Aplicando o ajuste que você pediu.",
  prototype_approved: "Opção aprovada, seguindo para o pacote.",
  package_finalizing: "Montando o pacote com Feed, Stories e legenda.",
  package_qa: "Conferindo o pacote no controle de qualidade.",
  awaiting_package_review: "Esperando sua revisão do pacote.",
  approved_for_manual_delivery: "Preparando os arquivos para você baixar.",
  delivered: "Arquivos entregues, arquivando no Linear.",
  archived: "Pronto: os arquivos já foram entregues.",
  rejected: "Pedido encerrado por você.",
  cancelled: "Pedido cancelado.",
  failed: "O pedido parou com falha. Precisa de alguém olhar.",
  angles_ready: "Escolhendo os ângulos do artigo.",
  awaiting_angle_selection: "Esperando você escolher o ângulo.",
  draft_generating: "Escrevendo o rascunho do artigo.",
  copy_review: "Revisando o texto do artigo.",
  awaiting_copy_review: "Esperando sua revisão do texto.",
  copy_approved: "Texto aprovado, preparando a entrega.",
};

const TEXTO = {
  boasVindas: "Me diga o tema do post. Exemplo: guarda-corpo de vidro para sacada.",
  qualFormato: "Feed, Stories ou os dois?",
  confirmado: "Confirmado. Vou preparar três direções e te mando as prévias.",
  semPedido: "Nenhum pedido em andamento. Me diga o tema do post.",
  useCancelar: "Para começar outro pedido, mande /cancelar.",
  nadaParaCancelar: "Não tem pedido aberto para cancelar.",
  cancelado: "Pedido cancelado. Me diga outro tema quando quiser.",
  encerrado: "Pedido encerrado. Não vou entregar nada dele.",
  tardeDemais: "Esse pedido já passou do ponto de cancelar.",
  soQuemPediu: "Só quem pediu ou o aprovador pode cancelar.",
  naoDeuParaCancelar: "Não consegui cancelar agora. Mande /status para ver como está.",
  rodadaMudou: "Essa rodada já mudou. Mande /status para ver como está.",
  ajusteAnotado: "Ajuste anotado. Vou preparar a versão nova.",
  briefSumiu: "Esse brief não está mais aberto. Me diga o tema do post.",
  botaoVencido: "Esse botão não vale mais.",
  recusouTodas: "Recusei as três direções.",
} as const;

/** Etapas em que o fluxo espera uma decisão humana, derivadas da tabela de revisões. */
const ESPERAS = new Set<string>(Object.values(ESPERA));

/**
 * `aoCallback` sempre responde o balãozinho do botão. Quando a decisão vem de um
 * comando digitado não existe botão para responder, e este id marca isso: o envio
 * falha no Telegram real e é engolido lá, e a resposta ao Ricardo vai por mensagem.
 */
const SEM_BOTAO = "sem-botao";

// ---------------------------------------------------------------------------
// Codec dos botões de conversa: c|<acao>|<arg>. Aprovação continua em a|.
// ---------------------------------------------------------------------------

export type AcaoConversa = "f" | "ok" | "no";

interface CallbackConversa {
  readonly acao: AcaoConversa;
  readonly arg: string;
}

export function codificarConversa(acao: AcaoConversa, arg: string): string {
  return `c|${acao}|${arg}`;
}

function decodificarConversa(data: string): CallbackConversa | null {
  const partes = data.split("|");
  if (partes.length !== 3 || partes[0] !== "c") return null;
  const [, acao, arg] = partes as [string, string, string];
  if (acao !== "f" && acao !== "ok" && acao !== "no") return null;
  if (acao === "f") return FORMATOS.some((f) => f.valor === arg) ? { acao, arg } : null;
  return ID_RE.test(arg) ? { acao, arg } : null;
}

// ---------------------------------------------------------------------------
// Narração do update
// ---------------------------------------------------------------------------

type Classe =
  | "texto"
  | "start"
  | "status"
  | "cancelar"
  | "formato"
  | "confirmar"
  | "desistir"
  | "ajustar"
  | "decisao";

interface DeQuem {
  readonly chatId: number;
  readonly deId: number;
}

/** Um membro por classe: discriminante em união estreita não estreita nada. */
type Evento =
  | (DeQuem & { classe: "texto"; texto: string })
  | (DeQuem & { classe: "start" })
  | (DeQuem & { classe: "status" })
  | (DeQuem & { classe: "cancelar" })
  | (DeQuem & { classe: "formato"; callbackId: string; cb: CallbackConversa })
  | (DeQuem & { classe: "confirmar"; callbackId: string; cb: CallbackConversa })
  | (DeQuem & { classe: "desistir"; callbackId: string; cb: CallbackConversa })
  | (DeQuem & { classe: "ajustar"; callbackId: string; data: string })
  | (DeQuem & { classe: "decisao"; callbackId: string; data: string });

type EventoDe<C extends Classe> = Extract<Evento, { classe: C }>;

const COMANDOS: Record<string, "start" | "status" | "cancelar"> = {
  "/start": "start",
  "/status": "status",
  "/cancelar": "cancelar",
};

function objeto(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function inteiro(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) ? v : null;
}

/** Só o chat, para a allowlist do webhook decidir antes de qualquer trabalho. */
export function chatDoUpdate(update: unknown): number | null {
  const u = objeto(update);
  if (!u) return null;
  const doMensagem = inteiro(objeto(objeto(u.message)?.chat)?.id);
  if (doMensagem !== null) return doMensagem;
  return inteiro(objeto(objeto(objeto(u.callback_query)?.message)?.chat)?.id);
}

export function narrar(update: unknown): Evento | null {
  const u = objeto(update);
  if (!u) return null;

  const callback = objeto(u.callback_query);
  if (callback) {
    const chatId = inteiro(objeto(objeto(callback.message)?.chat)?.id);
    const deId = inteiro(objeto(callback.from)?.id);
    const callbackId = callback.id;
    const data = callback.data;
    if (chatId === null || deId === null || typeof callbackId !== "string" || typeof data !== "string") {
      return null;
    }
    const cb = decodificarConversa(data);
    if (cb?.acao === "f") return { classe: "formato", chatId, deId, callbackId, cb };
    if (cb?.acao === "ok") return { classe: "confirmar", chatId, deId, callbackId, cb };
    if (cb) return { classe: "desistir", chatId, deId, callbackId, cb };
    if (decodificar(data)?.acao === "ajustar") {
      return { classe: "ajustar", chatId, deId, callbackId, data };
    }
    return { classe: "decisao", chatId, deId, callbackId, data };
  }

  const mensagem = objeto(u.message);
  if (!mensagem) return null;
  const chatId = inteiro(objeto(mensagem.chat)?.id);
  const deId = inteiro(objeto(mensagem.from)?.id);
  const bruto = mensagem.text;
  if (chatId === null || deId === null || typeof bruto !== "string") return null;
  const texto = bruto.trim();
  if (!texto) return null;

  // Em grupo o Telegram manda /status@bot; o bot no comando não é parte dele.
  const primeira = texto.split(/\s+/)[0]!.split("@")[0]!.toLowerCase();
  const comando = COMANDOS[primeira];
  if (comando) return { classe: comando, chatId, deId };
  return { classe: "texto", chatId, deId, texto };
}

// ---------------------------------------------------------------------------
// Tabela: etapa x classe de evento
// ---------------------------------------------------------------------------

type Etapa = EstadoConversa["etapa"];

const OCIOSA: EstadoConversa = { etapa: "ociosa" };

interface Ctx<C extends Classe> {
  readonly evento: EventoDe<C>;
  readonly chatId: number;
  readonly deId: number;
  readonly entrada: EntradaTelegram;
  readonly telegram: PortaTelegram;
  readonly aprovadorId: number;
  dizer(texto: string, botoes?: Botao[][]): Promise<void>;
}

/**
 * A etapa chega como segundo argumento, já estreitada pela célula: é a coluna da
 * tabela que decide qual variante do estado o passo pode ver. Devolver a etapa
 * nova; null mantém a que estava.
 */
type Passo<C extends Classe, E extends Etapa> = (
  c: Ctx<C>,
  estado: Extract<EstadoConversa, { etapa: E }>,
) => Promise<EstadoConversa | null>;
type Linha<C extends Classe> = { readonly [E in Etapa]: Passo<C, E> };
/** Passo que serve em qualquer coluna: recebe o estado sem estreitar e olha a etapa se precisar. */
type PassoEmTodas<C extends Classe> = (c: Ctx<C>, estado: EstadoConversa) => Promise<EstadoConversa | null>;
type PassoQualquer = PassoEmTodas<Classe>;

function emQualquerEtapa<C extends Classe>(p: PassoEmTodas<C>): Linha<C> {
  return { ociosa: p, formato: p, confirmacao: p, instrucao: p };
}

function podeCancelar(c: { deId: number; aprovadorId: number }, fluxo: Fluxo): boolean {
  return c.deId === c.aprovadorId || c.deId === fluxo.solicitanteId;
}

async function perguntarFormato(
  c: { dizer: Ctx<Classe>["dizer"] },
  tema: string,
): Promise<EstadoConversa> {
  await c.dizer(TEXTO.qualFormato, [
    FORMATOS.map((f) => ({ text: f.rotulo, callback_data: codificarConversa("f", f.valor) })),
  ]);
  return { etapa: "formato", tema };
}

async function mostrarBrief(
  c: { dizer: Ctx<Classe>["dizer"] },
  fluxoId: FluxoId,
  pedido: Pedido,
): Promise<void> {
  await c.dizer(`Tema: ${pedido.theme}\nFormato: ${ROTULO_FORMATO[pedido.format]}\nConfirmo e começo?`, [
    [
      { text: "Confirmar", callback_data: codificarConversa("ok", fluxoId) },
      { text: "Cancelar", callback_data: codificarConversa("no", fluxoId) },
    ],
  ]);
}

/**
 * Como chamar a peça que o botão aponta. Só o protótipo com mais de uma opção tem
 * numeração que o Ricardo viu na tela; no resto, número inventado aqui seria
 * número que não existe em mensagem nenhuma.
 */
function rotuloDaOpcao(cb: Callback, revisao: RevisaoPendente): string | null {
  if (cb.stage !== "prototype" || !cb.opcao || revisao.versoes.length < 2) return null;
  const i = revisao.versoes.indexOf(cb.opcao);
  return i < 0 ? null : `v${i + 1}`;
}

function textoDaDecisao(v: Extract<ResultadoValidacao, { ok: true }>, estado: EstadoQualquer): string {
  const rotulo = rotuloDaOpcao(v.callback, v.revisao);
  switch (v.callback.acao) {
    case "aceitar": {
      const cabeca =
        v.callback.stage === "package" ? "Pacote aceito." : rotulo ? `Opção ${rotulo} aceita.` : "Opção aceita.";
      return `${cabeca}\n${ESTADO_EM_PALAVRAS[estado]}`;
    }
    case "recusar_todas":
      return `${TEXTO.recusouTodas}\n${ESTADO_EM_PALAVRAS[estado]}`;
    case "encerrar":
      return TEXTO.encerrado;
    case "cancelar":
      return TEXTO.cancelado;
    // O teclado de ajuste é classificado antes e pede a instrução; nunca decide aqui.
    case "ajustar":
      return TEXTO.ajusteAnotado;
  }
}

const comecar: PassoEmTodas<"start"> = async (c) => {
  await c.dizer(TEXTO.boasVindas);
  return OCIOSA;
};

const contarStatus: PassoEmTodas<"status"> = async (c) => {
  const ativo = c.entrada.fluxoAtivoDoChat(c.chatId);
  await c.dizer(ativo ? ESTADO_EM_PALAVRAS[ativo.estado] : TEXTO.semPedido);
  return null;
};

const cancelarPedido: PassoEmTodas<"cancelar"> = async (c) => {
  const ativo = c.entrada.fluxoAtivoDoChat(c.chatId);
  if (!ativo) {
    await c.dizer(TEXTO.nadaParaCancelar);
    return OCIOSA;
  }
  if (!podeCancelar(c, ativo)) {
    await c.dizer(TEXTO.soQuemPediu);
    return null;
  }
  const revisao = ESPERAS.has(ativo.estado) ? ativo.revisaoPendente : null;
  if (revisao) {
    // Em espera humana o cancelamento é uma decisão como as do teclado, e passa
    // pelo mesmo caminho para virar linha em approvals.
    const r = c.entrada.aoCallback({
      deId: c.deId,
      callbackId: SEM_BOTAO,
      data: codificar({
        fluxoId: ativo.id,
        stage: revisao.stage,
        acao: "cancelar",
        rodada: revisao.rodada,
      }),
    });
    if (!r.ok) {
      await c.dizer(TEXTO.naoDeuParaCancelar);
      return null;
    }
  } else {
    if (!arestaLegal(ativo.tipo, ativo.estado, "cancelled")) {
      await c.dizer(TEXTO.tardeDemais);
      return null;
    }
    c.entrada.cancelar(ativo.id, c.deId);
  }
  await c.dizer(TEXTO.cancelado);
  return OCIOSA;
};

const temaOuAviso: Passo<"texto", "ociosa"> = async (c) => {
  const ativo = c.entrada.fluxoAtivoDoChat(c.chatId);
  // Parado em requested é brief que ele nunca confirmou: tema novo toma o lugar.
  const substituivel = ativo !== null && ativo.estado === "requested" && podeCancelar(c, ativo);
  if (ativo && !substituivel) {
    await c.dizer(`${ESTADO_EM_PALAVRAS[ativo.estado]}\n${TEXTO.useCancelar}`);
    return null;
  }
  if (ativo) c.entrada.cancelar(ativo.id, c.deId);
  return perguntarFormato(c, c.evento.texto);
};

const temaNovo: Passo<"texto", "formato"> = async (c) => perguntarFormato(c, c.evento.texto);

const repetirBrief: Passo<"texto", "confirmacao"> = async (c, estado) => {
  const ativo = c.entrada.fluxoAtivoDoChat(c.chatId);
  if (!ativo || ativo.id !== estado.fluxoId) {
    await c.dizer(TEXTO.briefSumiu);
    return OCIOSA;
  }
  await mostrarBrief(c, ativo.id, ativo.pedido);
  return null;
};

const aplicarInstrucao: Passo<"texto", "instrucao"> = async (c, estado) => {
  const r = c.entrada.aoCallback({
    deId: c.deId,
    callbackId: SEM_BOTAO,
    data: estado.data,
    notas: c.evento.texto,
  });
  await c.dizer(r.ok ? TEXTO.ajusteAnotado : TEXTO.rodadaMudou);
  return OCIOSA;
};

const botaoVencido = async (c: {
  evento: { callbackId: string };
  telegram: PortaTelegram;
}): Promise<null> => {
  await c.telegram.responderCallback(c.evento.callbackId, TEXTO.botaoVencido);
  return null;
};

const escolherFormato: Passo<"formato", "formato"> = async (c, estado) => {
  await c.telegram.responderCallback(c.evento.callbackId);
  const pedido: Pedido = { theme: estado.tema, format: c.evento.cb.arg as FormatoPedido };
  const fluxoId = c.entrada.criarFluxo({
    tipo: "instagram",
    chatId: c.chatId,
    solicitanteId: c.deId,
    pedido,
  });
  await mostrarBrief(c, fluxoId, pedido);
  return { etapa: "confirmacao", fluxoId };
};

const confirmarBrief: Passo<"confirmar", "confirmacao"> = async (c, estado) => {
  const ativo = c.entrada.fluxoAtivoDoChat(c.chatId);
  const alvo = estado.fluxoId;
  if (c.evento.cb.arg !== alvo || ativo?.id !== alvo || ativo.estado !== "requested") {
    return botaoVencido(c);
  }
  await c.telegram.responderCallback(c.evento.callbackId);
  c.entrada.confirmarBrief(alvo);
  await c.dizer(TEXTO.confirmado);
  return OCIOSA;
};

const desistirDoBrief: Passo<"desistir", "confirmacao"> = async (c, estado) => {
  const ativo = c.entrada.fluxoAtivoDoChat(c.chatId);
  const alvo = estado.fluxoId;
  if (c.evento.cb.arg !== alvo || ativo?.id !== alvo) return botaoVencido(c);
  if (!podeCancelar(c, ativo)) {
    await c.telegram.responderCallback(c.evento.callbackId, TEXTO.soQuemPediu);
    return null;
  }
  await c.telegram.responderCallback(c.evento.callbackId);
  c.entrada.cancelar(alvo, c.deId);
  await c.dizer(TEXTO.cancelado);
  return OCIOSA;
};

const pedirInstrucao: PassoEmTodas<"ajustar"> = async (c, estado) => {
  const v = c.entrada.validarCallback({ deId: c.deId, data: c.evento.data });
  if (!v.ok) {
    // aoCallback é quem manda o motivo pelo balãozinho; repetir aqui seriam dois textos.
    c.entrada.aoCallback({ deId: c.deId, callbackId: c.evento.callbackId, data: c.evento.data });
    return estado.etapa === "instrucao" ? OCIOSA : null;
  }
  await c.telegram.responderCallback(c.evento.callbackId);
  const rotulo = rotuloDaOpcao(v.callback, v.revisao);
  await c.dizer(
    `O que você quer mudar ${rotulo ? `na ${rotulo}` : "nessa versão"}? Responda em uma mensagem.`,
  );
  return { etapa: "instrucao", data: c.evento.data };
};

const decidirNoTeclado: PassoEmTodas<"decisao"> = async (c, estado) => {
  // A leitura vem antes da decisão: depois dela a revisão já fechou e o vN some.
  const antes = c.entrada.validarCallback({ deId: c.deId, data: c.evento.data });
  const r = c.entrada.aoCallback({ deId: c.deId, callbackId: c.evento.callbackId, data: c.evento.data });
  // Botão novo no meio de uma instrução pendente: o ajuste antigo morre com ele.
  const proxima = estado.etapa === "instrucao" ? OCIOSA : null;
  if (!r.ok || !antes.ok) return proxima;
  await c.dizer(textoDaDecisao(antes, r.estado));
  return proxima;
};

const TABELA: { readonly [C in Classe]: Linha<C> } = {
  texto: {
    ociosa: temaOuAviso,
    formato: temaNovo,
    confirmacao: repetirBrief,
    instrucao: aplicarInstrucao,
  },
  start: emQualquerEtapa(comecar),
  status: emQualquerEtapa(contarStatus),
  cancelar: emQualquerEtapa(cancelarPedido),
  formato: {
    ociosa: botaoVencido,
    formato: escolherFormato,
    confirmacao: botaoVencido,
    instrucao: botaoVencido,
  },
  confirmar: {
    ociosa: botaoVencido,
    formato: botaoVencido,
    confirmacao: confirmarBrief,
    instrucao: botaoVencido,
  },
  desistir: {
    ociosa: botaoVencido,
    formato: botaoVencido,
    confirmacao: desistirDoBrief,
    instrucao: botaoVencido,
  },
  ajustar: emQualquerEtapa(pedirInstrucao),
  decisao: emQualquerEtapa(decidirNoTeclado),
};

// ---------------------------------------------------------------------------

export interface Conversa {
  tratar(update: unknown): Promise<void>;
}

export function criarConversa(o: {
  entrada: EntradaTelegram;
  telegram: PortaTelegram;
  aprovadorId: number;
}): Conversa {
  const filas = new Map<number, Promise<void>>();

  async function processar(evento: Evento): Promise<void> {
    const estado = o.entrada.conversa.ler(evento.chatId);
    const ctx: Ctx<Classe> = {
      evento,
      chatId: evento.chatId,
      deId: evento.deId,
      entrada: o.entrada,
      telegram: o.telegram,
      aprovadorId: o.aprovadorId,
      dizer: async (texto, botoes) => {
        await o.telegram.enviarMensagem(
          evento.chatId,
          texto,
          botoes ? { reply_markup: { inline_keyboard: botoes } } : undefined,
        );
      },
    };
    // A célula é escolhida em tempo de execução; a totalidade quem garante é TABELA.
    const passo = TABELA[evento.classe][estado.etapa] as PassoQualquer;
    const proxima = await passo(ctx, estado);
    if (proxima) o.entrada.conversa.gravar(evento.chatId, proxima);
  }

  return {
    tratar(update) {
      const evento = narrar(update);
      if (!evento) return Promise.resolve();
      const chatId = evento.chatId;
      const anterior = filas.get(chatId) ?? Promise.resolve();
      const atual = anterior.then(() =>
        processar(evento).catch((erro) => {
          console.error(`conversa: chat ${chatId} não foi tratado: ${erro}`);
        }),
      );
      filas.set(chatId, atual);
      void atual.then(() => {
        if (filas.get(chatId) === atual) filas.delete(chatId);
      });
      return atual;
    },
  };
}
