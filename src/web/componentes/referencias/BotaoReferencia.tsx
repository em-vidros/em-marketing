import { useState } from "react";
import { alternarMarcada, useMarcadas, usarComoReferencia } from "./marcadas";
import type { ReferenciaDaApi } from "../../api";

/** O botão que aparece no hover de uma imagem da Biblioteca: marca como referência do próximo pedido, e outro clique tira. */
export function BotaoReferencia({ referencia, imagem }: { referencia?: ReferenciaDaApi; imagem?: { url: string; nome: string } }) {
  const marcadas = useMarcadas();
  const [subindo, setSubindo] = useState(false);
  const marcada = referencia ? marcadas.some((r) => r.id === referencia.id) : false;
  const rotulo = subindo ? "Adicionando…" : marcada ? "Marcada" : "Referência";
  return (
    <button
      type="button"
      aria-pressed={marcada}
      disabled={subindo}
      title={marcada ? "Tirar das referências do pedido" : "Usar como referência no próximo pedido"}
      onClick={async () => {
        if (referencia) return alternarMarcada(referencia);
        if (!imagem) return;
        setSubindo(true);
        await usarComoReferencia(imagem.url, imagem.nome);
        setSubindo(false);
      }}
      className={`pressiona absolute top-2 left-2 z-10 flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium whitespace-nowrap backdrop-blur-sm transition-opacity duration-150 ${
        marcada ? "bg-tinta text-sobre-tinta opacity-100" : "bg-black/60 text-white opacity-0 group-hover:opacity-100 group-hover/imagem:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
      }`}
    >
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        {marcada ? <path d="M2.5 6.5l2.2 2.2L9.5 3.5" /> : <path d="M6 2v8M2 6h8" />}
      </svg>
      {rotulo}
    </button>
  );
}
