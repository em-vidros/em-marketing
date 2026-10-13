import { ErroDeApi } from "../../api";
import { navegar } from "../../rota";
import { ehAprovacao, ehDelegacao, type Mensagem } from "../../tipos";
import type { Aviso } from "../menu/conversas";
import type { PilhaDeDesfazer } from "../menu/desfazer";

/** A resposta do DELETE de uma mensagem. O restaurar recebe este mesmo objeto, sem mudança. */
export interface Remocao {
  removidas: Mensagem[];
  depoisDe: string | null;
  antesDe: string | null;
}

/**
 * A mesma regra do servidor (agent/conversas.ts, apagarMensagem): a mensagem do usuário leva o
 * turno inteiro, até a próxima mensagem do usuário; a do bot leva só ela.
 */
export function tirarTurno(mensagens: readonly Mensagem[], id: string): { restantes: Mensagem[]; remocao: Remocao } | null {
  const i = mensagens.findIndex((m) => m.id === id);
  if (i === -1) return null;
  const proxima = mensagens.findIndex((m, j) => j > i && m.role === "user");
  const fim = mensagens[i]!.role !== "user" ? i + 1 : proxima === -1 ? mensagens.length : proxima;
  return {
    restantes: mensagens.toSpliced(i, fim - i),
    remocao: { removidas: mensagens.slice(i, fim), depoisDe: mensagens[i - 1]?.id ?? null, antesDe: mensagens[fim]?.id ?? null },
  };
}

/** Põe as removidas de volta depois de `depoisDe`. Se já estão lá, ou a vizinha sumiu, não mexe: a resposta do servidor decide. */
export function recolocar(mensagens: readonly Mensagem[], { removidas, depoisDe }: Remocao): Mensagem[] {
  const ids = new Set(removidas.map((m) => m.id));
  if (mensagens.some((m) => ids.has(m.id))) return [...mensagens];
  const inicio = depoisDe === null ? 0 : mensagens.findIndex((m) => m.id === depoisDe) + 1;
  if (depoisDe !== null && inicio === 0) return [...mensagens];
  return mensagens.toSpliced(inicio, 0, ...removidas);
}

const semAs = (mensagens: readonly Mensagem[], removidas: readonly Mensagem[]) => {
  const ids = new Set(removidas.map((m) => m.id));
  return mensagens.filter((m) => !ids.has(m.id));
};

/** Tarefa delegada ou pedido de aprovação: o turno fez coisas que apagar a mensagem não desfaz. */
export const deixaEfeitos = (removidas: readonly Mensagem[]) => removidas.some((m) => m.parts.some((p) => ehDelegacao(p) || ehAprovacao(p)));

export const textoDaMensagem = (m: Mensagem) =>
  m.parts.flatMap((p) => (p.type === "text" && p.text.trim() ? [p.text] : [])).join(m.role === "user" ? "" : "\n\n");

export interface ApiMensagens {
  apagar(conversaId: string, mensagemId: string): Promise<Remocao>;
  restaurar(conversaId: string, remocao: Remocao): Promise<Mensagem[]>;
}

async function pedir<T>(caminho: string, init: RequestInit): Promise<T> {
  const res = await fetch(caminho, { ...init, headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}) } });
  if (res.status === 401) navegar("/entrar", { substituir: true });
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroDeApi(res.status, corpo?.erro ?? `Erro ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const daConversa = (id: string) => `/api/conversas/${encodeURIComponent(id)}/mensagens`;

export const apiMensagens: ApiMensagens = {
  apagar: (conversaId, mensagemId) => pedir(`${daConversa(conversaId)}/${encodeURIComponent(mensagemId)}`, { method: "DELETE" }),
  restaurar: async (conversaId, remocao) =>
    (await pedir<{ mensagens: Mensagem[] }>(`${daConversa(conversaId)}/restaurar`, { method: "POST", body: JSON.stringify(remocao) })).mensagens,
};

const motivo = (e: unknown) => (e instanceof ErroDeApi ? ` ${e.message}` : "");

export interface Historico {
  ler: () => readonly Mensagem[];
  escrever: (mensagens: Mensagem[]) => void;
  /** O bot está respondendo: o histórico ainda muda, então o desfazer não mexe nele antes do servidor. */
  ocupado: () => boolean;
}

/**
 * Apagar some com a mensagem na hora e empilha o desfazer na pilha do app, que o toast e o ⌘Z
 * consomem. O desfazer manda ao servidor o mesmo corpo que o DELETE devolveu. Uma falha volta a
 * tela ao que o servidor tem e avisa.
 */
export function criarApagarMensagem(conversaId: string, h: Historico, api: ApiMensagens, pilha: PilhaDeDesfazer, avisar: (a: Aviso) => void) {
  return async function apagar(id: string): Promise<void> {
    const local = tirarTurno(h.ler(), id);
    if (!local) return;
    h.escrever(local.restantes);
    const pedido = api.apagar(conversaId, id);
    const chave = pilha.empilhar(async () => {
      const remocao = await pedido.catch(() => null);
      if (!remocao) return;
      if (!h.ocupado()) h.escrever(recolocar(h.ler(), remocao));
      try {
        h.escrever(await api.restaurar(conversaId, remocao));
      } catch (e) {
        h.escrever(semAs(h.ler(), remocao.removidas));
        avisar({ tipo: "erro", texto: `Não deu para pôr a mensagem de volta.${motivo(e)}` });
      }
    });
    try {
      const remocao = await pedido;
      // Um ⌘Z antes da resposta já desfez: o toast não tem mais o que oferecer.
      if (pilha.contem(chave))
        avisar({
          tipo: "desfazivel",
          chave,
          texto: deixaEfeitos(remocao.removidas) ? "Mensagem apagada. As artes e agendamentos feitos continuam valendo." : "Mensagem apagada.",
        });
    } catch (e) {
      pilha.descartar(chave);
      h.escrever(recolocar(h.ler(), local.remocao));
      avisar({ tipo: "erro", texto: `Não deu para apagar a mensagem.${motivo(e)}` });
    }
  };
}
