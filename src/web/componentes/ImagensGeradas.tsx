import { Download04Icon, PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import type { ImagemDaBiblioteca } from "../../domain/biblioteca";
import { useApi } from "../api";
import { aoClicarLink } from "../rota";
import { useAbrirNoEditor } from "./EscolhaDeArtes";
import { Falha } from "./Falha";
import { Segmentado } from "./Segmentado";
import { dia } from "./peca";
import { BotaoReferencia } from "./referencias/BotaoReferencia";

const POR_VEZ = 24;

const PROPORCAO = { feed: "aspect-[4/5]", story: "aspect-[9/16]" } as const;

const acao =
  "pressiona grid size-9 cursor-pointer place-items-center rounded-full bg-superficie text-tinta shadow-[0_1px_2px_rgb(0_0_0/0.12),0_0_0_1px_rgb(0_0_0/0.06)] disabled:cursor-default";

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

function detalheDa(i: ImagemDaBiblioteca): string {
  const formato = i.formato === "feed" ? "Feed" : "Story";
  if (i.origem === "estudio") return `Estúdio · ${formato}`;
  if (i.tipo === "story") return "Story";
  if (i.tipo === "foto") return `Foto real · ${formato}`;
  return `Variação ${i.variante} · ${formato}`;
}

const tituloDa = (i: ImagemDaBiblioteca) => i.titulo ?? "Imagem sem título";

type Pasta = "todas" | "selecionadas" | "descartadas";

/** As pastas filtram pela escolha do post. As artes do estúdio e as opções ainda sem escolha só aparecem em Todas. */
const PASTAS = {
  todas: { rotulo: "Todas", cabe: () => true, vazia: "" },
  selecionadas: {
    rotulo: "Selecionadas",
    cabe: (i: ImagemDaBiblioteca) => i.origem === "post" && i.pasta === "selecionada",
    vazia: "Nenhuma arte escolhida ainda. Quando você escolhe uma variação na conversa, ela vem para cá.",
  },
  descartadas: {
    rotulo: "Descartadas",
    cabe: (i: ImagemDaBiblioteca) => i.origem === "post" && i.pasta === "descartada",
    vazia: "Nenhuma imagem descartada. As variações que você não escolher vêm para cá.",
  },
} satisfies Record<Pasta, { rotulo: string; cabe: (i: ImagemDaBiblioteca) => boolean; vazia: string }>;

const ORDEM_DAS_PASTAS = ["todas", "selecionadas", "descartadas"] as const;

/** Toda imagem gerada, da equipe inteira, a mais nova primeiro, com os atalhos para editar e baixar. */
export function ImagensGeradas({ busca }: { busca: string }) {
  const [carga, tentar] = useApi<ImagemDaBiblioteca[]>("/api/biblioteca", 60000);
  const [abrindo, abrirNoEditor] = useAbrirNoEditor();
  const [limite, setLimite] = useState(POR_VEZ);
  const [pasta, setPasta] = useState<Pasta>("todas");
  const termo = normalizar(busca.trim());
  const buscadas = carga.estado === "pronto" ? carga.dados.filter((i) => !termo || normalizar(tituloDa(i)).includes(termo)) : [];
  const imagens = buscadas.filter(PASTAS[pasta].cabe);
  const abas = ORDEM_DAS_PASTAS.map((valor) => ({ valor, rotulo: PASTAS[valor].rotulo, contagem: buscadas.filter(PASTAS[valor].cabe).length }));

  return (
    <section aria-labelledby="imagens" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-linha pt-6">
        <h2 id="imagens" className="text-[15px] font-semibold">
          Imagens
        </h2>
        {carga.estado === "pronto" && carga.dados.length > 0 && (
          <Segmentado tipo="abas" rotulo="Pasta" opcoes={abas} valor={pasta} aoMudar={setPasta} idDoPainel="imagens-da-pasta" />
        )}
      </div>
      <div id="imagens-da-pasta" role="tabpanel" aria-label={PASTAS[pasta].rotulo} className="flex flex-col gap-4">
      {carga.estado === "carregando" ? (
        <p className="text-tinta-3">Carregando…</p>
      ) : carga.estado === "erro" ? (
        <Falha texto="Não deu para carregar as imagens." erro={carga.erro} tentar={tentar} />
      ) : carga.dados.length === 0 ? (
        <p className="py-4 text-tinta-3">Nenhuma imagem ainda. Toda arte que os bots gerarem fica guardada aqui, inclusive as variações que não foram escolhidas.</p>
      ) : imagens.length === 0 ? (
        <p className="py-4 text-tinta-3">{termo ? "Nenhuma imagem com essa busca." : PASTAS[pasta].vazia}</p>
      ) : (
        <>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(160px,40vw),1fr))] items-end gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
            {imagens.slice(0, limite).map((i) => {
              const titulo = tituloDa(i);
              const editar = i.origem === "post" ? `/api/imagens/${i.id}/editar` : null;
              return (
                <li key={`${i.origem}-${i.id}`} className="flex min-w-0 flex-col gap-2">
                  <div className="editavel group/imagem relative overflow-hidden rounded-cartao">
                    <img
                      src={i.url}
                      alt={`${detalheDa(i)}: ${titulo}`}
                      loading="lazy"
                      decoding="async"
                      className={`w-full bg-ativo object-cover outline-1 -outline-offset-1 outline-black/10 ${PROPORCAO[i.formato]}`}
                    />
                    <BotaoReferencia imagem={{ url: i.url, nome: `${i.origem}-${i.id}.${i.origem === "estudio" ? "png" : "jpg"}` }} />
                    <div className="editar absolute top-2 right-2 z-10 flex gap-1.5">
                      {editar ? (
                        <button
                          type="button"
                          onClick={() => void abrirNoEditor(editar)}
                          disabled={abrindo.tipo === "abrindo"}
                          aria-label={`Editar ${titulo}`}
                          title="Editar no editor de arte"
                          className={acao}
                        >
                          <HugeiconsIcon icon={PencilEdit02Icon} size={18} strokeWidth={1.75} aria-hidden="true" />
                        </button>
                      ) : (
                        <a href={`/artes/${i.id}`} onClick={aoClicarLink} aria-label={`Editar ${titulo}`} title="Editar no editor de arte" className={acao}>
                          <HugeiconsIcon icon={PencilEdit02Icon} size={18} strokeWidth={1.75} aria-hidden="true" />
                        </a>
                      )}
                      <a
                        href={i.url}
                        download={`em-vidros-${i.origem}-${i.id}.${i.origem === "estudio" ? "png" : "jpg"}`}
                        target="_blank"
                        rel="noreferrer"
                        aria-label={`Baixar ${titulo}`}
                        title="Baixar"
                        className={acao}
                      >
                        <HugeiconsIcon icon={Download04Icon} size={18} strokeWidth={1.75} aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                  <span className="line-clamp-2 text-sm/snug font-medium text-pretty [overflow-wrap:anywhere]">{titulo}</span>
                  <span className="-mt-1 flex justify-between gap-2 text-xs text-tinta-3">
                    <span className="truncate">{detalheDa(i)}</span>
                    <span className="flex-none tabular">{dia.format(new Date(i.criadaEm))}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {imagens.length > limite && (
            <button
              type="button"
              onClick={() => setLimite((l) => l + POR_VEZ)}
              className="pressiona cursor-pointer self-start rounded-full bg-linha px-3.5 py-1.5 text-[13px] font-medium hover:bg-linha-forte"
            >
              Mostrar mais
            </button>
          )}
        </>
      )}
      </div>
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
