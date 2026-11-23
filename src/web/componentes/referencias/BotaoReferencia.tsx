import { useState } from "react";
import type { ReferenciaDaApi } from "../../api";
import { alternarMarcada, useMarcadas, usarComoReferencia } from "./marcadas";

const TROCA = "absolute inset-0 size-full transition-[opacity,scale,filter] duration-200 ease-(--ease-saida) motion-reduce:transition-opacity";
const MOSTRADO = "scale-100 opacity-100 blur-none";
const ESCONDIDO = "scale-[0.25] opacity-0 blur-[4px] motion-reduce:scale-100 motion-reduce:blur-none";

/**
 * O botão do hover de uma imagem da Biblioteca: marca como referência do próximo pedido, e outro clique tira.
 * Fica no canto oposto ao das outras ações, com o mesmo tamanho delas: "compacto" ao lado do × das referências e
 * das peças prontas, "cheio" ao lado do editar e do baixar das imagens.
 */
export function BotaoReferencia({
  referencia,
  imagem,
  tamanho = "compacto",
}: {
  referencia?: ReferenciaDaApi;
  imagem?: { url: string; nome: string };
  tamanho?: "compacto" | "cheio";
}) {
  const marcadas = useMarcadas();
  const [subindo, setSubindo] = useState(false);
  const marcada = referencia ? marcadas.some((r) => r.id === referencia.id) : false;
  const cheio = tamanho === "cheio";
  const rotulo = marcada ? "Tirar das referências do pedido" : "Usar como referência no próximo pedido";
  const botao = (
    <button
      type="button"
      aria-pressed={marcada}
      aria-label={rotulo}
      title={rotulo}
      disabled={subindo}
      onClick={async () => {
        if (referencia) return alternarMarcada(referencia);
        if (!imagem) return;
        setSubindo(true);
        await usarComoReferencia(imagem.url, imagem.nome);
        setSubindo(false);
      }}
      className={`pressiona grid cursor-pointer place-items-center rounded-full disabled:cursor-default ${cheio ? "size-9" : "size-7"} ${
        marcada
          ? "bg-tinta text-sobre-tinta"
          : cheio
            ? "bg-superficie text-tinta shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_1px_rgb(0_0_0/0.06)]"
            : "bg-black/65 text-white"
      }`}
    >
      {/* O + vira ✓ com blur e escala; os dois ficam empilhados e só opacidade, escala e blur mudam. */}
      <span aria-hidden="true" className={`relative grid ${cheio ? "size-4" : "size-[13px]"} place-items-center`}>
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`${TROCA} ${marcada ? ESCONDIDO : MOSTRADO} ${subindo ? "animate-pulse" : ""}`}>
          <path d="M6 2.5v7M2.5 6h7" />
        </svg>
        <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={`${TROCA} ${marcada ? MOSTRADO : ESCONDIDO}`}>
          <path d="M2.5 6.5l2.2 2.2L9.5 3.5" />
        </svg>
      </span>
    </button>
  );
  // Nas imagens o CSS de .editar mostra as ações no hover; marcada, o botão fica à vista.
  if (cheio) return <div className={`editar absolute top-2 left-2 z-10 ${marcada ? "opacity-100!" : ""}`}>{botao}</div>;
  // Uma camada só anima a entrada: opacidade e escala, na mesma curva. Filtro e backdrop-filter aqui piscam.
  return (
    <div
      className={`absolute top-1.5 left-1.5 origin-top-left transition-[opacity,scale] duration-200 ease-(--ease-saida) focus-within:scale-100 focus-within:opacity-100 motion-reduce:transition-opacity ${
        marcada ? "scale-100 opacity-100" : "scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100 pointer-coarse:scale-100 pointer-coarse:opacity-100 motion-reduce:scale-100"
      }`}
    >
      {botao}
    </div>
  );
}
