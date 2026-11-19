import { PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { navegar } from "../rota";
import type { Parte } from "../tipos";

export type ParteMostrarArtes = Extract<Parte, { type: "tool-mostrar_artes" }>;

export const ehMostrarArtes = (p: Parte): p is ParteMostrarArtes => p.type === "tool-mostrar_artes";

type Abrindo = { tipo: "parado" } | { tipo: "abrindo" } | { tipo: "erro"; mensagem: string };

/** Cria (ou reabre) a arte do editor a partir da variação do post e vai para ela. */
function useAbrirNoEditor(postId: number | undefined) {
  const [estado, setEstado] = useState<Abrindo>({ tipo: "parado" });
  const abrir = async (variante: number) => {
    if (postId === undefined || estado.tipo === "abrindo") return;
    setEstado({ tipo: "abrindo" });
    try {
      const res = await fetch(`/api/posts/${postId}/variacoes/${variante}/editar`, { method: "POST" });
      const corpo = (await res.json().catch(() => null)) as { id?: string; erro?: string } | null;
      if (!res.ok || !corpo?.id) throw new Error(corpo?.erro ?? `Erro ${res.status}`);
      navegar(`/artes/${corpo.id}`);
    } catch (e) {
      setEstado({ tipo: "erro", mensagem: e instanceof Error ? e.message : "Não deu para abrir o editor." });
    }
  };
  return [estado, abrir] as const;
}

/**
 * As variações do post lado a lado, cada uma com o botão que manda a escolha para o bot.
 * `escolher` é null quando a conversa já passou deste ponto ou o bot ainda está respondendo.
 * A variação escolhida ganha o atalho para o editor de camadas.
 */
export function EscolhaDeArtes({ parte, escolher }: { parte: ParteMostrarArtes; escolher: ((variante: number) => void) | null }) {
  const saida = parte.state === "output-available" && parte.output.ok ? parte.output : null;
  const postId = saida && "postId" in saida ? saida.postId : undefined;
  const [abrindo, abrirNoEditor] = useAbrirNoEditor(postId);
  if (!saida) return null;
  const { artes, formato } = saida;
  const escolhida = "escolhida" in saida ? saida.escolhida : null;
  const proporcao = formato === "stories" ? "aspect-[9/16]" : "aspect-[4/5]";
  return (
    <section aria-label="Escolha uma arte" className="flex flex-col gap-3">
      <ul className="grid max-w-2xl grid-cols-3 gap-2.5 sm:gap-3">
        {artes.map((a) => {
          const editavel = postId !== undefined && a.variante === escolhida;
          return (
            <li key={a.variante} className="flex min-w-0 flex-col gap-2">
              <div className={`relative overflow-hidden rounded-item ${editavel ? "editavel" : ""}`}>
                <a href={a.url} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={a.url}
                    alt={`Variação ${a.variante}, estilo ${a.estilo}. Abre em outra aba`}
                    loading="lazy"
                    className={`${proporcao} w-full bg-ativo object-cover outline-1 -outline-offset-1 outline-black/10`}
                  />
                </a>
                {editavel && (
                  <button
                    type="button"
                    onClick={() => void abrirNoEditor(a.variante)}
                    disabled={abrindo.tipo === "abrindo"}
                    aria-label={`Editar a variação ${a.variante} no editor de arte`}
                    title="Editar no editor de arte"
                    className="editar pressiona absolute top-2 right-2 grid size-9 cursor-pointer place-items-center rounded-full bg-superficie text-tinta shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_1px_rgb(0_0_0/0.06)] disabled:cursor-default"
                  >
                    <HugeiconsIcon icon={PencilEdit02Icon} size={18} strokeWidth={1.75} aria-hidden="true" />
                  </button>
                )}
              </div>
              {a.variante === escolhida ? (
                <span className="grid h-9 place-items-center rounded-full bg-ativo text-[13px] font-medium">
                  {editavel && abrindo.tipo === "abrindo" ? "Abrindo o editor…" : "Escolhida"}
                </span>
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
          );
        })}
      </ul>
      {abrindo.tipo === "erro" && (
        <p role="alert" className="text-sm text-erro">
          Não deu para abrir o editor: {abrindo.mensagem}. Tente de novo.
        </p>
      )}
    </section>
  );
}
