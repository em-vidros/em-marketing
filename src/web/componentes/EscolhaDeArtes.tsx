import type { Parte } from "../tipos";

export type ParteMostrarArtes = Extract<Parte, { type: "tool-mostrar_artes" }>;

export const ehMostrarArtes = (p: Parte): p is ParteMostrarArtes => p.type === "tool-mostrar_artes";

/**
 * As variações do post lado a lado, cada uma com o botão que manda a escolha para o bot.
 * `escolher` é null quando a conversa já passou deste ponto ou o bot ainda está respondendo.
 */
export function EscolhaDeArtes({ parte, escolher }: { parte: ParteMostrarArtes; escolher: ((variante: number) => void) | null }) {
  if (parte.state !== "output-available" || !parte.output.ok) return null;
  const { artes, formato } = parte.output;
  const escolhida = "escolhida" in parte.output ? parte.output.escolhida : null;
  const proporcao = formato === "stories" ? "aspect-[9/16]" : "aspect-[4/5]";
  return (
    <section aria-label="Escolha uma arte" className="flex flex-col gap-3">
      <ul className="grid max-w-2xl grid-cols-3 gap-2.5 sm:gap-3">
        {artes.map((a) => (
          <li key={a.variante} className="flex min-w-0 flex-col gap-2">
            <a href={a.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-item">
              <img
                src={a.url}
                alt={`Variação ${a.variante}, estilo ${a.estilo}. Abre em outra aba`}
                loading="lazy"
                className={`${proporcao} w-full bg-ativo object-cover outline-1 -outline-offset-1 outline-black/10`}
              />
            </a>
            {a.variante === escolhida ? (
              <span className="grid h-9 place-items-center rounded-full bg-ativo text-[13px] font-medium">Escolhida</span>
            ) : escolher ? (
              <button
                type="button"
                onClick={() => escolher(a.variante)}
                className="pressiona h-9 cursor-pointer rounded-full border border-linha-forte text-[13px] font-medium hover:bg-hover"
              >
                {escolhida ? `Trocar pela ${a.variante}` : `Usar a ${a.variante}`}
              </button>
            ) : (
              <span className="text-center text-xs text-tinta-3">Variação {a.variante}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
