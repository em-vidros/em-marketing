import { useEffect, useRef, useSyncExternalStore } from "react";
import { acorde, type Atalho, ATALHOS, type AtalhoId, type Escopo, ehMac, resolver, type Tecla } from "./atalhos";

/** A ação de um atalho. Devolver false diz "não era comigo": a tecla segue para o navegador. */
export type Acao = (e?: KeyboardEvent) => boolean | void;

/** Pilha por atalho: quem ligou por último responde, e ao desmontar o anterior volta. */
const ligados = new Map<AtalhoId, Acao[]>();
const ouvintes = new Set<() => void>();
let versao = 0;
const avisar = () => {
  versao++;
  for (const o of ouvintes) o();
};

function ligar(id: AtalhoId, acao: Acao) {
  ligados.set(id, [...(ligados.get(id) ?? []), acao]);
  avisar();
  return () => {
    const pilha = (ligados.get(id) ?? []).filter((a) => a !== acao);
    if (pilha.length) ligados.set(id, pilha);
    else ligados.delete(id);
    avisar();
  };
}

export const estaLigado = (id: AtalhoId) => ligados.has(id);

/** Roda a ação ligada a um atalho, como se a tecla tivesse sido apertada. A paleta e os menus usam isto. */
export function executar(id: AtalhoId, e?: KeyboardEvent): boolean {
  const acao = ligados.get(id)?.at(-1);
  return acao ? acao(e) !== false : false;
}

/**
 * Liga a ação de um atalho enquanto o componente está montado. A tabela em `atalhos.ts` é o
 * único lugar onde a tecla existe; aqui só entra o que ela faz.
 */
export function useAtalho(id: AtalhoId, acao: Acao, ativo = true) {
  const atual = useRef(acao);
  atual.current = acao;
  useEffect(() => (ativo ? ligar(id, (e) => atual.current(e)) : undefined), [id, ativo]);
}

/** Muda quando um atalho liga ou desliga; a paleta mostra só o que tem ação agora. */
export const useLigados = () =>
  useSyncExternalStore(
    (o) => (ouvintes.add(o), () => ouvintes.delete(o)),
    () => versao,
  );

interface Alvo {
  tagName: string;
  isContentEditable?: boolean;
  type?: string;
  closest?: (seletor: string) => unknown;
}

const NAO_TEXTO = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"]);

/** Campo onde a tecla vira texto. Um checkbox não é campo; um contenteditable é. */
export function ehCampo(el: Alvo | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  return el.tagName === "INPUT" && !NAO_TEXTO.has(el.type ?? "text");
}

export function escoposDe(el: Alvo | null): Escopo[] {
  return el?.closest?.('[data-escopo="conversa"]') ? ["conversa", "global"] : ["lista", "global"];
}

/** Menus, paleta e folha de atalhos tratam as próprias teclas; ali só passa o que vale em campo. */
const ISOLADO = '[data-teclado="isolado"]';

const ESPERA_DA_SEQUENCIA = 1200;

/** O estado entre teclas: o prefixo de uma sequência ("g" esperando o "a"). */
export function criarDespachante(mac: boolean, ligado: (id: AtalhoId) => boolean = estaLigado) {
  let pendente: string[] = [];
  let desde = 0;

  return function despachar(e: Tecla & { repeat?: boolean; isComposing?: boolean }, alvo: Alvo | null, agora: number): AtalhoId | null {
    if (e.isComposing) return null;
    const c = acorde(e, mac);
    if (!c) return null;
    if (agora - desde > ESPERA_DA_SEQUENCIA) pendente = [];
    if (c === "escape" && pendente.length) {
      pendente = [];
      return null;
    }
    const isolado = !!alvo?.closest?.(ISOLADO);
    const ctx = { emCampo: isolado || ehCampo(alvo), escopos: escoposDe(alvo), ligado };
    let digitado = [...pendente, c];
    let r = resolver(digitado, ctx);
    // A sequência não fechou: a tecla atual pode começar outra.
    if (r.tipo === "nada" && pendente.length) {
      digitado = [c];
      r = resolver(digitado, ctx);
    }
    if (r.tipo === "prefixo") {
      pendente = digitado;
      desde = agora;
      return null;
    }
    pendente = [];
    if (r.tipo === "nada") return null;
    const a: Atalho = ATALHOS[r.id];
    if (e.repeat && !a.repete) return null;
    return r.id;
  };
}

/** Escuta o teclado da janela. Instale uma vez, na raiz do app logado. */
export function useTeclado() {
  useEffect(() => {
    const despachar = criarDespachante(ehMac);
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const foco = document.activeElement as HTMLElement | null;
      // Esc tira o foco do campo, e as teclas de uma letra voltam a valer (Linear, Grok).
      if (e.key === "Escape" && ehCampo(foco) && !foco?.closest(ISOLADO)) {
        foco?.blur();
        return;
      }
      const id = despachar(e, foco, performance.now());
      if (id && executar(id, e)) e.preventDefault();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);
}
