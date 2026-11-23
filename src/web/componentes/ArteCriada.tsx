import { useState } from "react";
import { aoClicarLink } from "../rota";
import type { Parte } from "../tipos";
import { apagarComDesfazer } from "./apagarArte";
import { fecharAviso } from "./menu/Avisos";
import { pilhaDeDesfazer } from "./menu/desfazer";

type ParteDeArteCriada = Extract<Parte, { type: "tool-criar_convite" | "tool-criar_aniversario" }>;

/** Só a arte que a tool criou ganha o cartão. Uma recusa ou um erro continua como passo, com o motivo na resposta do bot. */
export const ehArteCriada = (p: Parte): p is ParteDeArteCriada =>
  (p.type === "tool-criar_convite" || p.type === "tool-criar_aniversario") && p.state === "output-available" && p.output.ok;

type Situacao = { tipo: "viva" } | { tipo: "apagando" } | { tipo: "apagada"; chave: number } | { tipo: "erro"; mensagem: string };

const TITULO = { "tool-criar_convite": "Convite criado", "tool-criar_aniversario": "Arte de aniversário criada" } as const;

/**
 * A arte que o bot criou no estúdio, com o atalho para o editor. Apagar mostra o desfazer aqui no cartão e no aviso,
 * e a arte volta com as camadas que tinha.
 */
export function ArteCriada({ parte }: { parte: ParteDeArteCriada }) {
  const [situacao, setSituacao] = useState<Situacao>({ tipo: "viva" });
  if (parte.state !== "output-available" || !parte.output.ok) return null;
  const { arteId, url, editor, formato, textos } = parte.output;

  async function apagar() {
    setSituacao({ tipo: "apagando" });
    try {
      const { chave } = await apagarComDesfazer(arteId, () => setSituacao({ tipo: "viva" }));
      setSituacao({ tipo: "apagada", chave });
    } catch (e) {
      setSituacao({ tipo: "erro", mensagem: e instanceof Error ? e.message : "Algo deu errado." });
    }
  }

  if (situacao.tipo === "apagada") {
    const { chave } = situacao;
    return (
      <section aria-label="Arte apagada" className="flex max-w-md items-center gap-3 rounded-cartao border border-linha bg-superficie px-4 py-3">
        <p role="status" className="mr-auto text-sm text-tinta-2">
          Arte apagada.
        </p>
        <button
          type="button"
          onClick={() => (fecharAviso(chave), void pilhaDeDesfazer.consumir(chave))}
          className="pressiona cursor-pointer rounded-full bg-linha px-3.5 py-1.5 text-[13px] font-medium hover:bg-linha-forte"
        >
          Desfazer
        </button>
      </section>
    );
  }

  return (
    <section aria-label={TITULO[parte.type]} className="flex max-w-md gap-4 rounded-cartao border border-linha bg-superficie p-3">
      <a href={editor} onClick={aoClicarLink} className="flex-none" aria-label="Abrir a arte no editor">
        <img
          src={url}
          alt={`Arte: ${textos[0] ?? "sem texto"}`}
          className={`${formato === "story" ? "w-[84px] aspect-[9/16]" : "w-28 aspect-[4/5]"} rounded-item bg-ativo object-cover outline-1 -outline-offset-1 outline-black/10`}
        />
      </a>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-[15px] font-semibold">{TITULO[parte.type]}</h3>
          <p className="line-clamp-3 text-[13px] text-tinta-3 [overflow-wrap:anywhere]">{textos.join(" · ")}</p>
        </div>
        <div className="mt-auto flex flex-wrap gap-2">
          <a href={editor} onClick={aoClicarLink} className="pressiona rounded-full bg-tinta px-3.5 py-1.5 text-[13px] font-medium text-sobre-tinta">
            Abrir no editor
          </a>
          <button
            type="button"
            onClick={() => void apagar()}
            disabled={situacao.tipo === "apagando"}
            className="pressiona cursor-pointer rounded-full bg-linha px-3.5 py-1.5 text-[13px] font-medium hover:bg-linha-forte disabled:cursor-default disabled:opacity-50"
          >
            {situacao.tipo === "apagando" ? "Apagando…" : "Apagar"}
          </button>
        </div>
        {situacao.tipo === "erro" && (
          <p role="alert" className="text-[13px] text-erro">
            Não deu para apagar: {situacao.mensagem}
          </p>
        )}
      </div>
    </section>
  );
}
