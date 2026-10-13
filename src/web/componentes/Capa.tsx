import { useState } from "react";

/**
 * A arte de uma peça em 4:5. Sem arte, ou se a imagem não carrega, mostra a headline
 * num cartão neutro para a peça continuar reconhecível.
 */
export function Capa({ url, headline, className = "" }: { url: string | null; headline: string | null; className?: string }) {
  const [falhou, setFalhou] = useState(false);
  const mostrar = url && !falhou;
  return (
    <div
      className={`relative aspect-[4/5] flex-none [container-type:inline-size] overflow-hidden bg-ativo shadow-[inset_0_0_0_1px_var(--color-linha)] ${className}`}
    >
      {mostrar ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFalhou(true)}
          className="absolute inset-0 size-full object-cover outline outline-1 -outline-offset-1 outline-black/10"
        />
      ) : (
        headline && (
          <span className="absolute inset-x-0 bottom-0 line-clamp-4 p-[8%] text-[clamp(8px,7cqw,15px)] leading-tight text-balance text-tinta-2">
            {headline}
          </span>
        )
      )}
    </div>
  );
}
