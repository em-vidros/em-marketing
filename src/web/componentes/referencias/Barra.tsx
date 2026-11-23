import { useRef } from "react";
import { ACEITOS, type ControleDaEscolha } from "./escolha";
import { Seletor } from "./Seletor";

/**
 * A esquerda da barra do composer de um bot que gera artes: o seletor da Biblioteca, o anexar (o caminho do celular,
 * onde não há colar nem soltar) e, quando uma imagem segura a mensagem, por quê.
 */
export function BarraDaEscolha({ controle }: { controle: ControleDaEscolha }) {
  const { escolha, espera, alternar, colar, tentar } = controle;
  const arquivo = useRef<HTMLInputElement>(null);
  return (
    <>
      <Seletor marcadas={escolha.marcadas} alternar={alternar} />
      <button
        type="button"
        aria-label="Anexar imagem ao pedido"
        title="Anexar imagem ao pedido"
        onClick={() => arquivo.current?.click()}
        className="pressiona grid size-[34px] flex-none cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-preenchimento hover:text-tinta"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 4.25v11.5M4.25 10h11.5" />
        </svg>
      </button>
      <input
        ref={arquivo}
        type="file"
        accept={ACEITOS.join(",")}
        multiple
        hidden
        onChange={(e) => {
          colar([...(e.currentTarget.files ?? [])]);
          e.currentTarget.value = "";
        }}
      />
      <span role="status" className={espera ? "truncate pl-1 text-legenda" : "sr-only"}>
        {espera === "subindo" ? (
          <span className="text-tinta-3">Subindo a imagem…</span>
        ) : espera === "falhou" ? (
          <span className="text-erro">Não subiu.</span>
        ) : null}
      </span>
      {espera === "falhou" && (
        <button
          type="button"
          onClick={tentar}
          className="pressiona h-7 flex-none cursor-pointer rounded-full bg-preenchimento px-3 text-nota font-medium whitespace-nowrap hover:bg-preenchimento-forte"
        >
          Tentar de novo
        </button>
      )}
    </>
  );
}

/** Por cima da coluna da conversa enquanto um arquivo é arrastado na janela. */
export function SoltarAqui() {
  return (
    <div
      aria-hidden="true"
      className="soltar-aqui material pointer-events-none fixed inset-0 z-[70] flex flex-col items-center justify-center gap-1.5 px-6 text-center md:absolute md:inset-5 md:rounded-[20px] md:shadow-[inset_0_0_0_1px_var(--color-separador)]"
    >
      <span className="mb-3 grid size-[72px] place-items-center rounded-[18px] bg-superficie text-tinta shadow-[0_0_0_0.5px_var(--color-separador),0_4px_14px_-4px_var(--color-sombra-longe)]">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="15" height="14" rx="3" />
          <circle cx="8.5" cy="9" r="1.5" />
          <path d="m3.5 15.5 4-3.5 3 2.5 2-1.5 3.5 3" />
          <circle cx="18.5" cy="17.5" r="3.5" fill="var(--color-superficie)" />
          <path d="M18.5 16v3M17 17.5h3" />
        </svg>
      </span>
      <p className="text-[22px] font-bold tracking-[-0.02em]">Solte para usar neste pedido</p>
      <p className="max-w-sm text-[15px] text-pretty text-tinta-2">
        Até 3 imagens PNG, JPEG ou WebP, de até 10 MB cada. Elas valem só para a próxima mensagem.
      </p>
    </div>
  );
}
