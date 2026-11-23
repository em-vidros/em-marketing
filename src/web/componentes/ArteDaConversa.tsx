import { PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useState } from "react";
import { REGRA_DO_TEXTO } from "../../domain/art/conferencia";
import { useApi } from "../api";
import type { Parte } from "../tipos";
import { useAbrirNoEditor, type Escolhida } from "./EscolhaDeArtes";

type ParteDaArte = Extract<Parte, { type: "tool-ajustar_arte" | "tool-voltar_arte" | "tool-derivar_story" }>;

export const ehArteDaConversa = (p: Parte): p is ParteDaArte =>
  p.type === "tool-ajustar_arte" || p.type === "tool-voltar_arte" || p.type === "tool-derivar_story";

const ROTULO = {
  "tool-ajustar_arte": "Arte ajustada",
  "tool-voltar_arte": "Arte como estava",
  "tool-derivar_story": "Story",
} as const;

type Voltando = { tipo: "parado" } | { tipo: "voltando" } | { tipo: "voltou" } | { tipo: "erro"; mensagem: string };

/**
 * A arte que um ajuste, a volta de um ajuste ou a story deixaram na conversa. O ajuste tem o botão que desfaz,
 * enquanto ele ainda é a versão em uso do post.
 */
export function ArteDaConversa({ parte, versao }: { parte: ParteDaArte; versao: string }) {
  const saida = parte.state === "output-available" && parte.output.ok ? parte.output : null;
  const postId = saida && "postId" in saida ? saida.postId : undefined;
  const ehAjuste = parte.type === "tool-ajustar_arte";
  const [carga, reler] = useApi<Escolhida>(ehAjuste && postId !== undefined ? `/api/posts/${postId}/escolhida` : null, 15000);
  // A conversa mudou (o bot pode ter ajustado de novo ou voltado): relê qual versão está em uso.
  useEffect(() => reler(), [versao, reler]);
  const [abrindo, abrirNoEditor] = useAbrirNoEditor();
  const [voltando, setVoltando] = useState<Voltando>({ tipo: "parado" });
  if (!saida || !("url" in saida) || !saida.url) return null;

  const imagemId = "imagemId" in saida ? saida.imagemId : null;
  const story = parte.type === "tool-derivar_story" || ("formato" in saida && saida.formato === "stories");
  const atual = carga.estado === "pronto" ? carga.dados : null;
  const podeVoltar = ehAjuste && atual !== null && imagemId !== null && atual.imagemId === imagemId && atual.versoesAnteriores > 0;

  const voltar = async () => {
    if (voltando.tipo === "voltando") return;
    setVoltando({ tipo: "voltando" });
    try {
      const res = await fetch(`/api/posts/${postId}/voltar`, { method: "POST" });
      const corpo = (await res.json().catch(() => null)) as { erro?: string } | null;
      if (!res.ok) throw new Error(corpo?.erro ?? `Erro ${res.status}`);
      setVoltando({ tipo: "voltou" });
      reler();
    } catch (e) {
      setVoltando({ tipo: "erro", mensagem: e instanceof Error ? e.message : "Não deu para voltar." });
    }
  };

  return (
    <figure className={`flex flex-col gap-2 ${story ? "w-44 sm:w-52" : "w-56 sm:w-64"}`}>
      <div className="editavel relative overflow-hidden rounded-item">
        <a href={saida.url} target="_blank" rel="noreferrer" className="block">
          <img
            src={saida.url}
            alt={`${ROTULO[parte.type]}. Abre em outra aba`}
            loading="lazy"
            className={`${story ? "aspect-[9/16]" : "aspect-[4/5]"} w-full bg-ativo object-cover outline-1 -outline-offset-1 outline-black/10`}
          />
        </a>
        {imagemId != null && (
          <button
            type="button"
            onClick={() => void abrirNoEditor(`/api/imagens/${imagemId}/editar`)}
            disabled={abrindo.tipo === "abrindo"}
            aria-label={`Editar ${ROTULO[parte.type].toLowerCase()} no editor de arte`}
            title="Editar no editor de arte"
            className="editar pressiona absolute top-2 right-2 z-10 grid size-9 cursor-pointer place-items-center rounded-full bg-superficie text-tinta shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_1px_rgb(0_0_0/0.06)] disabled:cursor-default"
          >
            <HugeiconsIcon icon={PencilEdit02Icon} size={18} strokeWidth={1.75} aria-hidden="true" />
          </button>
        )}
      </div>
      <figcaption className="flex flex-col gap-2">
        <span className="text-xs text-tinta-3">{ROTULO[parte.type]}</span>
        {saida.problemas
          .filter((p) => p.regra === REGRA_DO_TEXTO)
          .map((p) => (
            <p key={p.detalhe} className="text-xs/snug text-pretty text-esperando-texto [overflow-wrap:anywhere]">
              {p.detalhe}
            </p>
          ))}
        {podeVoltar && voltando.tipo !== "voltou" && (
          <button
            type="button"
            onClick={() => void voltar()}
            disabled={voltando.tipo === "voltando"}
            className="pressiona h-9 cursor-pointer rounded-full border border-linha-forte text-[13px] font-medium hover:bg-hover disabled:cursor-default disabled:opacity-60"
          >
            {voltando.tipo === "voltando" ? "Voltando…" : "Voltar como estava"}
          </button>
        )}
        <p role="status" className={voltando.tipo === "voltou" ? "text-xs text-tinta-3" : "sr-only"}>
          {voltando.tipo === "voltou" ? "A arte voltou como estava. Esta versão fica na Biblioteca." : ""}
        </p>
        {voltando.tipo === "erro" && (
          <p role="alert" className="text-xs text-erro">
            Não deu para voltar: {voltando.mensagem}
          </p>
        )}
        {abrindo.tipo === "erro" && (
          <p role="alert" className="text-xs text-erro">
            Não deu para abrir o editor: {abrindo.mensagem}. Tente de novo.
          </p>
        )}
      </figcaption>
    </figure>
  );
}
