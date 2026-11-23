import { useEffect, useRef, useState } from "react";
import { apiPecasProntas, useApi, type PecaProntaDaApi } from "../api";
import { navegar } from "../rota";
import { enviarAoAbrir } from "./calendario/enviarAoAbrir";
import { Falha } from "./Falha";
import { mostrarAviso } from "./menu/Avisos";
import { pilhaDeDesfazer } from "./menu/desfazer";
import { BotaoReferencia } from "./referencias/BotaoReferencia";
import { imagensDe } from "./referencias/soltas";

/** Os mesmos limites do POST /api/pecas-prontas, checados antes para o erro sair na hora. */
export const ACEITOS = ["image/png", "image/jpeg", "image/webp"];
const MAXIMO = 10 * 1024 * 1024;

const FORMATO_DA_PECA = { feed: "Feed", story: "Story" } as const;

interface Enviando {
  id: number;
  url: string;
}

/** A lista de peças prontas da Biblioteca e o que muda nela: enviar, remover com desfazer. */
export function usePecasProntas() {
  const [carga, recarregar] = useApi<PecaProntaDaApi[]>("/api/pecas-prontas");
  const [enviando, setEnviando] = useState<Enviando[]>([]);
  const [removidas, setRemovidas] = useState<ReadonlySet<string>>(new Set());
  const proximo = useRef(0);

  function receber(arquivos: File[]) {
    for (const arquivo of arquivos) {
      if (!ACEITOS.includes(arquivo.type)) {
        mostrarAviso({ tipo: "erro", texto: `${arquivo.name || "A imagem"} não entrou: a peça pronta precisa ser PNG, JPEG ou WebP.` });
        continue;
      }
      if (arquivo.size > MAXIMO) {
        mostrarAviso({ tipo: "erro", texto: `${arquivo.name || "A imagem"} não entrou: passa de 10 MB.` });
        continue;
      }
      const item = { id: proximo.current++, url: URL.createObjectURL(arquivo) };
      setEnviando((e) => [item, ...e]);
      apiPecasProntas
        .enviar(arquivo)
        .then(recarregar)
        .catch((e: Error) => mostrarAviso({ tipo: "erro", texto: `Não deu para guardar a peça pronta. ${e.message}` }))
        .finally(() => {
          setEnviando((e) => e.filter((x) => x.id !== item.id));
          URL.revokeObjectURL(item.url);
        });
    }
  }

  async function remover(p: PecaProntaDaApi): Promise<boolean> {
    setRemovidas((s) => new Set(s).add(p.id));
    try {
      await apiPecasProntas.remover(p.id);
    } catch (e) {
      setRemovidas((s) => new Set([...s].filter((id) => id !== p.id)));
      mostrarAviso({ tipo: "erro", texto: `Não deu para remover a peça pronta. ${(e as Error).message}` });
      return false;
    }
    const chave = pilhaDeDesfazer.empilhar(async () => {
      await apiPecasProntas.restaurar(p.id);
      setRemovidas((s) => new Set([...s].filter((id) => id !== p.id)));
      recarregar();
    });
    mostrarAviso({ tipo: "desfazivel", chave, texto: "Peça pronta removida." });
    return true;
  }

  const lista = carga.estado === "pronto" ? carga.dados.filter((p) => !removidas.has(p.id)) : [];
  return { carga, lista, enviando, receber, remover, recarregar };
}

export type EstadoDasPecas = ReturnType<typeof usePecasProntas>;

/** Abre uma conversa nova com o Chefe e manda o pedido de publicar a peça; o cartão de aprovação aparece lá. */
export async function publicarComOChefe(p: PecaProntaDaApi) {
  try {
    const { conversaId, pedido } = await apiPecasProntas.conversa(p.id);
    navegar(`/c/${conversaId}`);
    enviarAoAbrir(conversaId, pedido);
  } catch (e) {
    mostrarAviso({ tipo: "erro", texto: `Não deu para abrir a conversa com o Chefe. ${(e as Error).message}` });
  }
}

/**
 * Artes feitas fora do app, como no Canva, que saem no Instagram como estão. A IA lê cada uma ao receber,
 * e o Chefe acha a peça por essa leitura. Nunca entram como referência na geração.
 */
export function PecasProntas({
  estado,
  soltando,
  aberta,
  abrir,
}: {
  estado: EstadoDasPecas;
  soltando: boolean;
  aberta: string | null;
  abrir: (id: string, de: HTMLElement) => void;
}) {
  const { carga, lista, enviando, receber, remover, recarregar } = estado;
  const seletor = useRef<HTMLInputElement>(null);

  return (
    <section aria-labelledby="titulo-pecas-prontas" className="flex flex-col gap-3 border-t border-linha pt-6">
      <div className="flex flex-col gap-0.5">
        <h2 id="titulo-pecas-prontas" className="text-[15px] font-semibold">
          Peças prontas
        </h2>
        <p className="text-[13px] text-pretty text-tinta-3">Artes feitas fora do app, como no Canva. O Chefe publica ou agenda cada uma como está, com legenda.</p>
        <input
          ref={seletor}
          type="file"
          accept={ACEITOS.join(",")}
          multiple
          hidden
          onChange={(e) => {
            receber(imagensDe(e.currentTarget.files));
            e.currentTarget.value = "";
          }}
        />
      </div>

      <p role="status" className="sr-only">
        {enviando.length ? `Lendo ${enviando.length === 1 ? "1 peça" : `${enviando.length} peças`}` : ""}
      </p>

      {carga.estado === "erro" ? (
        <Falha texto="Não deu para carregar as peças prontas." erro={carga.erro} tentar={recarregar} />
      ) : (
        <div
          data-soltando={soltando || undefined}
          className="rounded-cartao border border-dashed border-transparent transition-colors duration-150 data-soltando:border-tinta-3 data-soltando:bg-hover"
        >
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(136px,1fr))]">
            <li>
              <button
                type="button"
                aria-label="Adicionar peça pronta"
                title="Adicionar peça pronta"
                onClick={() => seletor.current?.click()}
                className="pressiona flex aspect-[4/5] w-full cursor-pointer items-center justify-center rounded-item border border-dashed border-linha-forte text-tinta-3 hover:border-tinta-3 hover:bg-hover hover:text-tinta"
              >
                <svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M11 4v14M4 11h14" />
                </svg>
              </button>
            </li>
            {enviando.map((e) => (
              <li key={`enviando-${e.id}`}>
                <div className="relative aspect-[4/5] overflow-hidden rounded-item bg-painel outline-1 -outline-offset-1 outline-linha">
                  <img src={e.url} alt="" className="size-full object-cover opacity-50" />
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 px-2 pt-4 pb-1.5 text-[11px] font-medium text-white">Lendo…</span>
                </div>
              </li>
            ))}
            {lista.map((p) => (
              <li key={p.id} className="group relative flex flex-col gap-1.5">
                <button
                  type="button"
                  aria-expanded={p.id === aberta}
                  onClick={(e) => abrir(p.id, e.currentTarget)}
                  className="pressiona-leve flex cursor-pointer flex-col gap-1.5 text-left"
                >
                  <span className="block aspect-[4/5] overflow-hidden rounded-item bg-painel outline-1 -outline-offset-1 outline-linha transition-shadow duration-150 group-has-aria-expanded:shadow-[0_0_0_2px_var(--color-tinta)]">
                    <img src={p.url} alt={p.texto || p.tema} loading="lazy" className="size-full object-contain" />
                  </span>
                  <span className="line-clamp-2 text-xs/snug text-pretty text-tinta-2">{p.tema}</span>
                  <span className="text-[11px] text-tinta-3">
                    {FORMATO_DA_PECA[p.formato]} · {p.pilar}
                  </span>
                </button>
                <BotaoReferencia imagem={{ url: p.url, nome: `peca-${p.id}.png` }} />
                <button
                  type="button"
                  aria-label={`Remover a peça pronta ${p.tema}`}
                  onClick={() => void remover(p)}
                  className="pressiona absolute top-1.5 right-1.5 flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                >
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
          {carga.estado === "pronto" && lista.length === 0 && enviando.length === 0 && (
            <p className="pt-3 text-[13px] text-tinta-3">Nenhuma peça pronta ainda. Arraste ou cole uma imagem aqui.</p>
          )}
        </div>
      )}
    </section>
  );
}

/** O painel de uma peça pronta: a imagem, a leitura da IA, a legenda e as ações. */
export function DetalheDaPecaPronta({ peca: p, fechar, remover }: { peca: PecaProntaDaApi; fechar: () => void; remover: () => void }) {
  const fecharRef = useRef<HTMLButtonElement>(null);
  const [abrindo, setAbrindo] = useState(false);
  useEffect(() => fecharRef.current?.focus({ preventScroll: true }), []);

  async function publicar() {
    setAbrindo(true);
    await publicarComOChefe(p);
    setAbrindo(false);
  }

  return (
    <>
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="mr-auto min-w-0 text-xs text-tinta-3">
          Peça pronta · {FORMATO_DA_PECA[p.formato]} · {p.pilar}
        </span>
        <button
          ref={fecharRef}
          type="button"
          onClick={fechar}
          aria-label="Fechar"
          className="pressiona -mr-1.5 grid size-10 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-hover"
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 pb-6">
        <h2 className="text-lg/snug font-semibold tracking-[-0.01em] text-balance [overflow-wrap:anywhere]">{p.tema}</h2>
        <img src={p.url} alt={p.texto || p.tema} className="max-h-[56vh] w-full rounded-item object-contain outline-1 -outline-offset-1 outline-linha" />
        {p.texto && (
          <section aria-label="Texto da peça" className="flex flex-col gap-1">
            <h3 className="text-xs font-normal text-tinta-3">Texto na arte</h3>
            <p className="whitespace-pre-line text-pretty [overflow-wrap:anywhere]">{p.texto}</p>
          </section>
        )}
        <section aria-label="Legenda" className="flex flex-col gap-1">
          <h3 className="text-xs font-normal text-tinta-3">Legenda</h3>
          <p className={`whitespace-pre-line text-pretty [overflow-wrap:anywhere] ${p.legenda ? "" : "text-tinta-3"}`}>
            {p.legenda || (p.formato === "story" ? "Story sai sem legenda." : "O Chefe escreve a legenda quando você pedir para publicar.")}
          </p>
        </section>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={abrindo}
            onClick={() => void publicar()}
            className="pressiona flex h-9 cursor-pointer items-center rounded-full bg-tinta px-4 text-[13px] font-medium text-sobre-tinta disabled:cursor-default disabled:opacity-50"
          >
            Publicar ou agendar com o Chefe
          </button>
          <button
            type="button"
            onClick={remover}
            className="pressiona flex h-9 cursor-pointer items-center rounded-full px-3.5 text-[13px] font-medium text-erro hover:bg-erro/8"
          >
            Remover
          </button>
        </div>
      </div>
    </>
  );
}
