import { motion, useReducedMotion } from "motion/react";
import { useSyncExternalStore } from "react";
import { apiImagensDoPedido, apiReferencias } from "../../api";
import { mostrarAviso } from "../menu/Avisos";
import { pilhaDeDesfazer } from "../menu/desfazer";
import { naBiblioteca, recarregarBiblioteca, useBiblioteca } from "./biblioteca";

/**
 * O que acontece com cada imagem do pedido nesta visita: guardando, falhou, ou guardada agora (com a entrada do ⌘Z,
 * que o Desfazer da cápsula consome). O balão e a imagem aberta grande leem o mesmo estado. Guardada de antes vem da
 * Biblioteca, sem Desfazer.
 */
type Local = { tipo: "guardando" } | { tipo: "falhou" } | { tipo: "guardada"; desfazer: number } | { tipo: "tirada" };

const locais = new Map<string, Local>();
const ouvintes = new Set<() => void>();
let versao = 0;
const mudar = (chave: string, l: Local | null) => {
  if (l) locais.set(chave, l);
  else locais.delete(chave);
  versao++;
  ouvintes.forEach((o) => o());
};

async function guardar(chave: string) {
  mudar(chave, { tipo: "guardando" });
  try {
    const r = await apiImagensDoPedido.guardar(chave);
    await recarregarBiblioteca();
    // Outra pessoa, ou outro clique, guardou antes: a imagem aparece como já na Biblioteca, sem Desfazer.
    if (!r.criada) return mudar(chave, null);
    const desfazer = pilhaDeDesfazer.empilhar(async () => {
      // Volta a Guardar na hora; a lista da Biblioteca chega depois.
      mudar(chave, { tipo: "tirada" });
      try {
        await apiReferencias.remover(r.id);
      } catch (e) {
        mostrarAviso({ tipo: "erro", texto: `Não deu para tirar a imagem da Biblioteca. ${(e as Error).message}` });
      }
      await recarregarBiblioteca();
      mudar(chave, null);
    });
    mudar(chave, { tipo: "guardada", desfazer });
  } catch {
    mudar(chave, { tipo: "falhou" });
  }
}

export type EstadoDoGuardar = "livre" | "guardando" | "guardada" | "falhou" | "reaberta";

export function useGuardar(chave: string) {
  useSyncExternalStore(
    (o) => (ouvintes.add(o), () => ouvintes.delete(o)),
    () => versao,
  );
  const carga = useBiblioteca();
  const local = locais.get(chave);
  // Desfeita pelo ⌘Z, a entrada sai da pilha: a cápsula não oferece mais um Desfazer que não faz nada.
  const viva = local?.tipo === "guardada" && pilhaDeDesfazer.contem(local.desfazer);
  const naLista = naBiblioteca(carga, chave);
  const estado: EstadoDoGuardar =
    local?.tipo === "guardando"
      ? "guardando"
      : local?.tipo === "falhou"
        ? "falhou"
        : local?.tipo === "tirada"
          ? "livre"
          : viva && naLista
            ? "guardada"
            : naLista
              ? "reaberta"
              : "livre";
  return {
    estado,
    referencia: naLista ?? null,
    guardar: () => void guardar(chave),
    desfazer: () => local?.tipo === "guardada" && void pilhaDeDesfazer.consumir(local.desfazer),
  };
}

const PILULA = "flex h-8 min-w-[188px] items-center justify-center gap-1.5 rounded-full px-3.5 text-nota font-medium whitespace-nowrap";

/** Guardar a imagem do pedido na Biblioteca, onde a IA lê como nas outras referências. Os estados ocupam a mesma largura. */
export function GuardarNaBiblioteca({ chave }: { chave: string }) {
  const { estado, guardar, desfazer } = useGuardar(chave);
  const reduzido = useReducedMotion();
  if (estado === "livre")
    return (
      <button type="button" onClick={guardar} className={`pressiona cursor-pointer bg-preenchimento hover:bg-preenchimento-forte ${PILULA}`}>
        <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">
          <path d="M4 2.25h8v11.5L8 11l-4 2.75z" />
          <path d="M8 4.75v3.5M6.25 6.5h3.5" />
        </svg>
        Guardar na Biblioteca
      </button>
    );
  if (estado === "guardando")
    return (
      <span role="status" className={`bg-preenchimento text-tinta-3 ${PILULA}`}>
        <svg aria-hidden="true" viewBox="0 0 16 16" width="13" height="13" className="animate-spin motion-reduce:animate-none">
          <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="1.75" />
          <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
        Lendo a imagem…
      </span>
    );
  if (estado === "falhou")
    return (
      <span role="alert" className={`material gap-2 pr-1 pl-2.5 shadow-capsula ${PILULA}`}>
        <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
          <circle cx="8" cy="8" r="8" fill="var(--color-erro)" />
          <path d="M8 4.5v4" stroke="white" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="8" cy="11.25" r="1" fill="white" />
        </svg>
        <span className="text-erro">Não deu para guardar.</span>
        <button type="button" onClick={guardar} className="pressiona h-6 cursor-pointer rounded-full bg-preenchimento px-3 font-medium text-tinta hover:bg-preenchimento-forte">
          Tentar de novo
        </button>
      </span>
    );
  const check = (
    <motion.svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="16"
      height="16"
      initial={estado === "guardada" && !reduzido ? { scale: 0.6, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", bounce: 0, duration: 0.3 }}
    >
      <circle cx="8" cy="8" r="8" fill="var(--color-trabalhando-texto)" />
      <path d="m4.75 8.25 2.25 2.25 4.25-4.75" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </motion.svg>
  );
  if (estado === "reaberta")
    return (
      <span className={`text-tinta-2 ${PILULA}`}>
        {check}
        Na Biblioteca
      </span>
    );
  return (
    <span role="status" className={`material gap-0 px-0 shadow-capsula ${PILULA}`}>
      <span className="flex items-center gap-1.5 pr-3 pl-2.5 font-semibold text-tinta">
        {check}
        Na Biblioteca
      </span>
      <span aria-hidden="true" className="h-4 w-px bg-separador" />
      <button type="button" onClick={desfazer} className="h-8 cursor-pointer rounded-r-full pr-3.5 pl-3 text-tinta-2 hover:text-tinta">
        Desfazer
      </button>
    </span>
  );
}
