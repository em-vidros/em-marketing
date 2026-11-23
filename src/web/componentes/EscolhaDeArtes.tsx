import { PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { useApi } from "../api";
import { navegar } from "../rota";
import type { Parte } from "../tipos";
import { ReferenciasUsadas } from "./referencias/Usadas";

export type ParteMostrarArtes = Extract<Parte, { type: "tool-mostrar_artes" }>;

export const ehMostrarArtes = (p: Parte): p is ParteMostrarArtes => p.type === "tool-mostrar_artes";

type Abrindo = { tipo: "parado" } | { tipo: "abrindo"; caminho: string } | { tipo: "erro"; mensagem: string };

/** Cria (ou reabre) a arte do editor a partir de uma imagem gerada e vai para ela. `caminho` é a rota POST que devolve {id}. */
export function useAbrirNoEditor() {
  const [estado, setEstado] = useState<Abrindo>({ tipo: "parado" });
  const abrir = async (caminho: string) => {
    if (estado.tipo === "abrindo") return;
    setEstado({ tipo: "abrindo", caminho });
    try {
      const res = await fetch(caminho, { method: "POST" });
      const corpo = (await res.json().catch(() => null)) as { id?: string; erro?: string } | null;
      if (!res.ok || !corpo?.id) throw new Error(corpo?.erro ?? `Erro ${res.status}`);
      navegar(`/artes/${corpo.id}`);
    } catch (e) {
      setEstado({ tipo: "erro", mensagem: e instanceof Error ? e.message : "Não deu para abrir o editor." });
    }
  };
  return [estado, abrir] as const;
}

type Escolhida = { imagemId: number | null; url: string | null };

/**
 * Qual variação o post tem escolhida agora. A saída de mostrar_artes é de antes da escolha, então a
 * tela pergunta ao servidor. O clique em "Usar" marca na hora, até o servidor contar outra coisa.
 */
function useEscolhida(postId: number | undefined) {
  const [carga] = useApi<Escolhida>(postId === undefined ? null : `/api/posts/${postId}/escolhida`, 15000);
  const doServidor = carga.estado === "pronto" ? carga.dados : null;
  const chave = JSON.stringify(doServidor);
  const [clicada, setClicada] = useState<{ variante: number; antes: string } | null>(null);
  const marcar = (variante: number) => setClicada({ variante, antes: chave });
  const local = clicada && clicada.antes === chave ? clicada.variante : null;
  return { doServidor, local, marcar };
}

/**
 * As variações do post lado a lado, cada uma com o botão que manda a escolha para o bot.
 * `escolher` é null quando a conversa já passou deste ponto ou o bot ainda está respondendo.
 * Toda variação tem o atalho para o editor de camadas.
 */
export function EscolhaDeArtes({ parte, escolher }: { parte: ParteMostrarArtes; escolher: ((variante: number) => void) | null }) {
  const saida = parte.state === "output-available" && parte.output.ok ? parte.output : null;
  const postId = saida && "postId" in saida ? saida.postId : undefined;
  const [abrindo, abrirNoEditor] = useAbrirNoEditor();
  const { doServidor, local, marcar } = useEscolhida(postId);
  if (!saida) return null;
  const { artes, formato } = saida;
  type Variacao = (typeof artes)[number];
  const naSaida = "escolhida" in saida ? saida.escolhida : null;
  const ehEscolhida = (a: Variacao) => {
    if (local !== null) return a.variante === local;
    if (!doServidor) return a.variante === naSaida;
    // Saídas antigas não têm imagemId; aí a URL da mídia, que é a mesma enquanto o arquivo não muda, identifica a variação.
    return a.imagemId != null && doServidor.imagemId !== null ? a.imagemId === doServidor.imagemId : a.url === doServidor.url;
  };
  const algumaEscolhida = artes.some(ehEscolhida);
  const editarEm = (a: Variacao) => (a.imagemId != null ? `/api/imagens/${a.imagemId}/editar` : `/api/posts/${postId}/variacoes/${a.variante}/editar`);
  const proporcao = formato === "stories" ? "aspect-[9/16]" : "aspect-[4/5]";
  return (
    <section aria-label="Escolha uma arte" className="flex flex-col gap-3">
      <ReferenciasUsadas artes={artes} />
      <ul className="grid max-w-2xl grid-cols-3 gap-2.5 sm:gap-3">
        {artes.map((a) => (
          <li key={a.variante} className="flex min-w-0 flex-col gap-2">
            <div className={`relative overflow-hidden rounded-item ${postId !== undefined ? "editavel" : ""}`}>
              <a href={a.url} target="_blank" rel="noreferrer" className="block">
                <img
                  src={a.url}
                  alt={`Variação ${a.variante}. Abre em outra aba`}
                  loading="lazy"
                  className={`${proporcao} w-full bg-ativo object-cover outline-1 -outline-offset-1 outline-black/10`}
                />
              </a>
              {postId !== undefined && (
                <button
                  type="button"
                  onClick={() => void abrirNoEditor(editarEm(a))}
                  disabled={abrindo.tipo === "abrindo"}
                  aria-label={`Editar a variação ${a.variante} no editor de arte`}
                  title="Editar no editor de arte"
                  className="editar pressiona absolute top-2 right-2 z-10 grid size-9 cursor-pointer place-items-center rounded-full bg-superficie text-tinta shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_1px_rgb(0_0_0/0.06)] disabled:cursor-default"
                >
                  <HugeiconsIcon icon={PencilEdit02Icon} size={18} strokeWidth={1.75} aria-hidden="true" />
                </button>
              )}
            </div>
            {ehEscolhida(a) ? (
              <span className="grid h-9 place-items-center rounded-full bg-ativo text-[13px] font-medium">Escolhida</span>
            ) : escolher ? (
              <button
                type="button"
                onClick={() => (marcar(a.variante), escolher(a.variante))}
                className="pressiona h-9 cursor-pointer rounded-full border border-linha-forte text-[13px] font-medium hover:bg-hover"
              >
                {algumaEscolhida ? `Trocar pela ${a.variante}` : `Usar a ${a.variante}`}
              </button>
            ) : (
              <span className="text-center text-xs text-tinta-3">Variação {a.variante}</span>
            )}
          </li>
        ))}
      </ul>
      <p role="status" className={abrindo.tipo === "abrindo" ? "text-sm text-tinta-3" : "sr-only"}>
        {abrindo.tipo === "abrindo" ? "Abrindo o editor…" : ""}
      </p>
      {abrindo.tipo === "erro" && (
        <p role="alert" className="text-sm text-erro">
          Não deu para abrir o editor: {abrindo.mensagem}. Tente de novo.
        </p>
      )}
    </section>
  );
}
