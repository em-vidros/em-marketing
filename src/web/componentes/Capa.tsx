import { useState } from "react";

/**
 * A arte de uma peça em 4:5. Sem arte, ou se a imagem não carrega, mostra a headline
 * num cartão neutro para a peça continuar reconhecível; sem headline, o `vazio`.
 */
export function Capa({
  url,
  headline,
  alt = "",
  vazio,
  className = "",
}: {
  url: string | null;
  headline: string | null;
  /** Vazio quando a capa é decorativa ao lado do título; descreva quando a arte é o conteúdo. */
  alt?: string;
  /** O aviso no lugar de uma arte que não carregou, quando não há headline para mostrar. */
  vazio?: string;
  className?: string;
}) {
  const [falhou, setFalhou] = useState(false);
  const mostrar = url && !falhou;
  const texto = headline ?? (falhou || !url ? vazio : null);
  return (
    <div
      className={`relative aspect-[4/5] flex-none [container-type:inline-size] overflow-hidden bg-ativo shadow-[inset_0_0_0_1px_var(--color-linha)] ${className}`}
    >
      {mostrar ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFalhou(true)}
          className="absolute inset-0 size-full object-cover outline outline-1 -outline-offset-1 outline-black/10"
        />
      ) : (
        texto && (
          // O recorte fica no span de dentro: no de fora, o padding mostraria um pedaço da quinta linha.
          <span className="absolute inset-x-0 bottom-0 p-[8%] text-[clamp(8px,7cqw,15px)] leading-tight text-balance text-tinta-2 [overflow-wrap:anywhere]">
            <span className="line-clamp-4">{texto}</span>
          </span>
        )
      )}
    </div>
  );
}
