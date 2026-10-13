import { useSyncExternalStore, type MouseEvent } from "react";
import { BOT_IDS, type BotId } from "./bots";

export type Rota =
  | { tela: "entrar" }
  | { tela: "nova" }
  | { tela: "conversa"; id: string }
  | { tela: "atividade" }
  | { tela: "biblioteca" }
  | { tela: "calendario" }
  | { tela: "bot"; id: BotId; aba: "trabalho" | "config" }
  | { tela: "nao-encontrada" };

export function lerRota(caminho: string): Rota {
  if (caminho === "/") return { tela: "nova" };
  if (caminho === "/entrar") return { tela: "entrar" };
  if (caminho === "/atividade") return { tela: "atividade" };
  if (caminho === "/biblioteca") return { tela: "biblioteca" };
  if (caminho === "/calendario") return { tela: "calendario" };
  const bot = /^\/bots\/([^/]+)(\/config)?$/.exec(caminho);
  const botId = BOT_IDS.find((id) => id === bot?.[1]);
  if (botId) return { tela: "bot", id: botId, aba: bot?.[2] ? "config" : "trabalho" };
  const conversa = /^\/c\/([^/]+)$/.exec(caminho);
  if (conversa?.[1]) return { tela: "conversa", id: decodeURIComponent(conversa[1]) };
  return { tela: "nao-encontrada" };
}

const MUDOU = "rota:mudou";

function assinar(avisar: () => void) {
  window.addEventListener("popstate", avisar);
  window.addEventListener(MUDOU, avisar);
  return () => {
    window.removeEventListener("popstate", avisar);
    window.removeEventListener(MUDOU, avisar);
  };
}

export function navegar(caminho: string, { substituir = false } = {}) {
  if (caminho === location.pathname) return;
  history[substituir ? "replaceState" : "pushState"](null, "", caminho);
  window.dispatchEvent(new Event(MUDOU));
}

export const useCaminho = () => useSyncExternalStore(assinar, () => location.pathname);

/** Para um <a href>: navega sem recarregar, mas deixa ⌘-clique e clique do meio abrirem aba nova. */
export function aoClicarLink(e: MouseEvent<HTMLAnchorElement>) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navegar(e.currentTarget.pathname);
}
