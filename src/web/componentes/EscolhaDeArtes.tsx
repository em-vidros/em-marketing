import { PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { REGRA_DO_TEXTO } from "../../domain/art/conferencia";
import { useApi } from "../api";
import { navegar } from "../rota";
import type { Parte } from "../tipos";
import type { Ancora } from "../../domain/art/pipeline";
import { ReferenciasUsadas } from "./referencias/Usadas";

/** As partes que desenham as 3 variações: mostrar_artes e produzir_post, que chega arte por arte. */
export type ParteComArtes = Extract<Parte, { type: "tool-mostrar_artes" | "tool-produzir_post" }>;

/** produzir_post vira cartão quando já tem a headline; antes disso, e se falhar, é uma linha de passo como as outras tools. */
export const ehParteComArtes = (p: Parte): p is ParteComArtes =>
  p.type === "tool-mostrar_artes" || (p.type === "tool-produzir_post" && p.state === "output-available" && p.output.fase !== "brief" && p.output.fase !== "foto");

type Variacao = { variante: number; url: string; imagemId?: number | null; ancora?: Ancora | null; problemas: { regra: string; detalhe: string }[] };

interface Artes {
  postId: number | undefined;
  formato: string;
  escolhida: number | null;
  artes: Variacao[];
  /** As variações ainda gerando, que aparecem como vagas. */
  faltam: number[];
  /** A legenda que produzir_post escreveu enquanto as artes renderizavam. */
  legenda: string | null;
}

function artesDa(parte: ParteComArtes): Artes | null {
  if (parte.state !== "output-available") return null;
  if (parte.type === "tool-mostrar_artes") {
    const o = parte.output;
    if (!o.ok) return null;
    return { postId: o.postId, formato: o.formato, escolhida: o.escolhida, artes: o.artes, faltam: [], legenda: null };
  }
  const o = parte.output;
  const prontas = new Set(o.artes.map((a) => a.variante));
  const faltam = o.fase === "pronto" ? [] : [1, 2, 3].filter((v) => !prontas.has(v));
  return { postId: o.postId, formato: o.formato === "stories" ? "stories" : "feed", escolhida: null, artes: o.artes, faltam, legenda: o.legenda?.texto ?? null };
}

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
export function EscolhaDeArtes({ parte, escolher }: { parte: ParteComArtes; escolher: ((variante: number) => void) | null }) {
  const saida = artesDa(parte);
  const postId = saida?.postId;
  const [abrindo, abrirNoEditor] = useAbrirNoEditor();
  const { doServidor, local, marcar } = useEscolhida(postId);
  if (!saida) return null;
  const { artes, formato, faltam } = saida;
  const naSaida = saida.escolhida;
  const ehEscolhida = (a: Variacao) => {
    if (local !== null) return a.variante === local;
    if (!doServidor) return a.variante === naSaida;
    // Saídas antigas não têm imagemId; aí a URL da mídia, que é a mesma enquanto o arquivo não muda, identifica a variação.
    return a.imagemId != null && doServidor.imagemId !== null ? a.imagemId === doServidor.imagemId : a.url === doServidor.url;
  };
  const algumaEscolhida = artes.some(ehEscolhida);
  const editarEm = (a: Variacao) => (a.imagemId != null ? `/api/imagens/${a.imagemId}/editar` : `/api/posts/${postId}/variacoes/${a.variante}/editar`);
  const proporcao = formato === "stories" ? "aspect-[9/16]" : "aspect-[4/5]";
  const celula = (a: Variacao) => (
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
      {a.problemas
        .filter((p) => p.regra === REGRA_DO_TEXTO)
        .map((p) => (
          <p key={p.detalhe} className="text-xs/snug text-pretty text-esperando-texto [overflow-wrap:anywhere]">
            {p.detalhe}
          </p>
        ))}
      {ehEscolhida(a) ? (
        <span className="mt-auto grid h-9 place-items-center rounded-full bg-ativo text-[13px] font-medium">Escolhida</span>
      ) : escolher ? (
        <button
          type="button"
          onClick={() => (marcar(a.variante), escolher(a.variante))}
          className="pressiona mt-auto h-9 cursor-pointer rounded-full border border-linha-forte text-[13px] font-medium hover:bg-hover"
        >
          {algumaEscolhida ? `Trocar pela ${a.variante}` : `Usar a ${a.variante}`}
        </button>
      ) : (
        <span className="mt-auto text-center text-xs text-tinta-3">Variação {a.variante}</span>
      )}
    </li>
  );
  return (
    <section aria-label="Escolha uma arte" className="flex flex-col gap-3">
      <ReferenciasUsadas artes={artes} />
      <ul className="grid max-w-2xl grid-cols-3 gap-2.5 sm:gap-3">
        {[...artes.map((a) => ({ tipo: "arte" as const, a })), ...faltam.map((v) => ({ tipo: "vaga" as const, v }))]
          .sort((x, y) => (x.tipo === "arte" ? x.a.variante : x.v) - (y.tipo === "arte" ? y.a.variante : y.v))
          .map((item) =>
            item.tipo === "vaga" ? (
              <li key={item.v} className="flex min-w-0 flex-col gap-2">
                <div role="img" aria-label={`Variação ${item.v} ainda gerando`} className={`${proporcao} w-full rounded-item bg-ativo`} />
                <span className="mt-auto text-center text-xs text-tinta-3">Gerando a {item.v}</span>
              </li>
            ) : (
              celula(item.a)
            ),
          )}
      </ul>
      {saida.legenda && (
        <div className="flex max-w-2xl flex-col gap-1">
          <span className="text-xs text-tinta-3">Legenda</span>
          <p className="text-sm/relaxed whitespace-pre-line text-tinta-2 [overflow-wrap:anywhere]">{saida.legenda}</p>
        </div>
      )}
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
