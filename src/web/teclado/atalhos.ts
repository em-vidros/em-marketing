import { BOTS, type BotId } from "../bots";

/**
 * Onde um atalho vale. `global` vale em qualquer lugar; `lista` vale fora de uma região de
 * conversa e age na conversa focada na barra, ou na aberta; `conversa` vale com o foco dentro
 * de um elemento marcado com `data-escopo="conversa"`. As duas últimas nunca valem juntas,
 * então a mesma tecla pode ter um sentido em cada uma (R renomeia a linha, R recusa o cartão).
 */
export type Escopo = "global" | "lista" | "conversa";

export type Grupo = "Geral" | "Navegação" | "Conversas" | "Bots" | "Aprovação";

/**
 * Uma tecla é uma sequência de acordes separados por espaço ("g a"); um acorde junta
 * modificadores e a tecla com "+" ("mod+k"). `mod` é ⌘ no Mac e Ctrl fora dele.
 */
export interface Atalho {
  teclas: readonly string[];
  rotulo: string;
  grupo: Grupo;
  escopo: Escopo;
  /** Vale também com o foco num campo de texto. Só para acordes com modificador. */
  emCampo?: true;
  /** Segurar a tecla repete a ação. */
  repete?: true;
  /** Atalho de abrir um bot: o rótulo usa o nome em vigor, que o usuário pode trocar. */
  bot?: BotId;
}

/** O prefixo O mais uma letra abre a página do bot. */
const abrirBot = (bot: BotId, letra: string): Atalho => ({
  teclas: [`o ${letra}`],
  rotulo: `Abrir ${BOTS[bot].nome}`,
  grupo: "Bots",
  escopo: "global",
  bot,
});

export const ATALHOS = {
  paleta: { teclas: ["mod+k"], rotulo: "Abrir a paleta de comandos", grupo: "Geral", escopo: "global", emCampo: true },
  buscar: { teclas: ["/"], rotulo: "Buscar conversas", grupo: "Geral", escopo: "global" },
  atalhos: { teclas: ["?"], rotulo: "Ver os atalhos", grupo: "Geral", escopo: "global" },
  desfazer: { teclas: ["mod+z"], rotulo: "Desfazer", grupo: "Geral", escopo: "global" },
  "barra-lateral": { teclas: ["mod+\\"], rotulo: "Mostrar ou esconder a barra lateral", grupo: "Geral", escopo: "global", emCampo: true },
  "nova-conversa": { teclas: ["c"], rotulo: "Novo pedido", grupo: "Conversas", escopo: "global" },
  "focar-composer": { teclas: ["mod+l"], rotulo: "Escrever uma mensagem", grupo: "Conversas", escopo: "global", emCampo: true },
  "ir-atividade": { teclas: ["g a"], rotulo: "Ir para Atividade", grupo: "Navegação", escopo: "global" },
  "ir-biblioteca": { teclas: ["g b"], rotulo: "Ir para Biblioteca", grupo: "Navegação", escopo: "global" },
  "config-bot": { teclas: ["mod+,"], rotulo: "Configurar o bot desta tela", grupo: "Bots", escopo: "global", emCampo: true },
  "abrir-bot-chefe": abrirBot("chefe", "c"),
  "abrir-bot-post": abrirBot("post", "p"),
  "abrir-bot-legenda": abrirBot("legenda", "l"),
  "abrir-bot-agenda": abrirBot("agenda", "a"),
  "abrir-bot-fotos": abrirBot("fotos", "f"),
  "abrir-bot-reels": abrirBot("reels", "r"),
  "lista-proxima": { teclas: ["j", "arrowdown"], rotulo: "Próxima conversa", grupo: "Conversas", escopo: "lista", repete: true },
  "lista-anterior": { teclas: ["k", "arrowup"], rotulo: "Conversa anterior", grupo: "Conversas", escopo: "lista", repete: true },
  "lista-abrir": { teclas: ["enter"], rotulo: "Abrir a conversa focada", grupo: "Conversas", escopo: "lista" },
  "conversa-renomear": { teclas: ["r"], rotulo: "Renomear conversa", grupo: "Conversas", escopo: "lista" },
  "conversa-arquivar": { teclas: ["e"], rotulo: "Arquivar ou desarquivar conversa", grupo: "Conversas", escopo: "lista" },
  "conversa-excluir": { teclas: ["mod+backspace"], rotulo: "Excluir conversa", grupo: "Conversas", escopo: "lista" },
  "painel-tarefas": { teclas: ["mod+i"], rotulo: "Mostrar ou esconder o painel de tarefas", grupo: "Conversas", escopo: "global", emCampo: true },
  aprovar: { teclas: ["a"], rotulo: "Aprovar o cartão focado", grupo: "Aprovação", escopo: "conversa" },
  recusar: { teclas: ["r"], rotulo: "Recusar o cartão focado", grupo: "Aprovação", escopo: "conversa" },
} satisfies Record<string, Atalho>;

export type AtalhoId = keyof typeof ATALHOS;

export const IDS_DE_ATALHO = Object.keys(ATALHOS) as AtalhoId[];

export const GRUPOS: readonly Grupo[] = ["Geral", "Navegação", "Conversas", "Bots", "Aprovação"];

export const atalhoDoBot = (id: BotId) => `abrir-bot-${id}` as const satisfies AtalhoId;

/** O rótulo com o nome do bot em vigor, para os atalhos de abrir bot. */
export function rotuloDe(id: AtalhoId, nomes?: Partial<Record<BotId, { nome: string }>>): string {
  const a: Atalho = ATALHOS[id];
  return a.bot ? `Abrir ${nomes?.[a.bot]?.nome ?? BOTS[a.bot].nome}` : a.rotulo;
}

/** O que importa de um KeyboardEvent; separado para os testes não dependerem do DOM. */
export interface Tecla {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

const SO_MODIFICADOR = new Set(["Meta", "Control", "Alt", "Shift", "CapsLock", "Dead", "Unidentified"]);

/**
 * O acorde normalizado de uma tecla, ou null para um modificador sozinho. Shift só entra em
 * letras e teclas nomeadas: "?" já é Shift+/ e muda de lugar entre layouts (ABNT, US).
 */
export function acorde(e: Tecla, mac: boolean): string | null {
  if (SO_MODIFICADOR.has(e.key)) return null;
  const tecla = e.key === " " ? "space" : e.key.toLowerCase();
  const nomeada = tecla.length > 1 || /[a-z0-9]/.test(tecla);
  const mods: string[] = [];
  if (mac ? e.metaKey : e.ctrlKey) mods.push("mod");
  if (mac && e.ctrlKey) mods.push("ctrl");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey && nomeada) mods.push("shift");
  return [...mods, tecla].join("+");
}

/** Normaliza a ordem dos modificadores de um acorde escrito na tabela. */
function normalizarAcorde(a: string): string {
  const partes = a.split("+");
  const tecla = partes.pop()!;
  const ordem = ["mod", "ctrl", "alt", "shift"];
  return [...partes.sort((x, y) => ordem.indexOf(x) - ordem.indexOf(y)), tecla].join("+");
}

export const sequencia = (tecla: string): string[] => tecla.split(" ").map(normalizarAcorde);

const temModificador = (seq: readonly string[]) => seq.length === 1 && /^(mod|ctrl|alt)\+/.test(seq[0]!);

export interface Contexto {
  /** O foco está num input, textarea ou contenteditable. */
  emCampo: boolean;
  escopos: readonly Escopo[];
  /** O atalho tem uma ação ligada agora. */
  ligado: (id: AtalhoId) => boolean;
}

export type Resolucao = { tipo: "atalho"; id: AtalhoId } | { tipo: "prefixo" } | { tipo: "nada" };

/** Casa os acordes digitados (o prefixo pendente mais o atual) com a tabela. */
export function resolver(digitado: readonly string[], ctx: Contexto): Resolucao {
  let prefixo = false;
  for (const id of IDS_DE_ATALHO) {
    const a: Atalho = ATALHOS[id];
    if (!ctx.escopos.includes(a.escopo) || !ctx.ligado(id)) continue;
    for (const tecla of a.teclas) {
      const seq = sequencia(tecla);
      // Num campo, tecla sem modificador é texto; só passa o que foi marcado para valer ali.
      if (ctx.emCampo && !(a.emCampo && temModificador(seq))) continue;
      if (seq.length < digitado.length) continue;
      if (!digitado.every((c, i) => seq[i] === c)) continue;
      if (seq.length === digitado.length) return { tipo: "atalho", id };
      prefixo = true;
    }
  }
  return prefixo ? { tipo: "prefixo" } : { tipo: "nada" };
}

const SIMBOLO: Record<string, string> = {
  mod: "⌘",
  ctrl: "⌃",
  alt: "⌥",
  shift: "⇧",
  backspace: "⌫",
  enter: "↵",
  arrowdown: "↓",
  arrowup: "↑",
  escape: "Esc",
  space: "Espaço",
};
const PALAVRA: Record<string, string> = { mod: "Ctrl", ctrl: "Ctrl", alt: "Alt", shift: "Shift", backspace: "Backspace", enter: "Enter" };

/** As teclas de cada acorde de uma sequência, prontas para virar <kbd>: "g a" → [["G"], ["A"]]. */
export function teclasVisiveis(tecla: string, mac: boolean): string[][] {
  return sequencia(tecla).map((a) =>
    a.split("+").map((p) => (mac ? SIMBOLO[p] : (PALAVRA[p] ?? SIMBOLO[p])) ?? p.toUpperCase()),
  );
}

/** O valor de aria-keyshortcuts (WAI-ARIA), que usa nomes de tecla do DOM. */
export function ariaDe(id: AtalhoId, mac: boolean): string {
  const nome: Record<string, string> = {
    mod: mac ? "Meta" : "Control",
    ctrl: "Control",
    alt: "Alt",
    shift: "Shift",
    backspace: "Backspace",
    enter: "Enter",
    arrowdown: "ArrowDown",
    arrowup: "ArrowUp",
  };
  // Uma sequência ("g a") não tem notação em aria-keyshortcuts; só os acordes entram.
  return ATALHOS[id].teclas
    .map(sequencia)
    .filter((s) => s.length === 1)
    .map(([a]) => a!.split("+").map((p) => nome[p] ?? p.toUpperCase()).join("+"))
    .join(" ");
}

export const ehMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
