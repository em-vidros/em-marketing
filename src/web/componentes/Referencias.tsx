import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { apiReferencias, useApi, type ReferenciaDaApi } from "../api";
import { Falha } from "./Falha";
import { mostrarAviso } from "./menu/Avisos";
import { pilhaDeDesfazer } from "./menu/desfazer";
import { imagensDe } from "./referencias/soltas";

/** Os mesmos limites do POST /api/referencias, checados antes para o erro sair na hora. */
const ACEITOS = ["image/png", "image/jpeg", "image/webp"];
const MAXIMO = 10 * 1024 * 1024;

interface Enviando {
  id: number;
  url: string;
}

/** Quem cola ou solta imagens na Biblioteca entrega aqui as que a pessoa marcou como referência. */
export interface EnvioDeReferencias {
  receber(arquivos: File[]): void;
}

/**
 * As imagens que inspiram a geração. Colar (⌘V) e soltar valem na tela inteira da Biblioteca, que pergunta
 * se a imagem é referência ou peça pronta. A IA lê cada imagem ao receber; o Chefe usa essas leituras.
 */
export function Referencias({ ref, soltando }: { ref?: Ref<EnvioDeReferencias>; soltando: boolean }) {
  const [carga, recarregar] = useApi<ReferenciaDaApi[]>("/api/referencias");
  const [enviando, setEnviando] = useState<Enviando[]>([]);
  const [removidas, setRemovidas] = useState<ReadonlySet<string>>(new Set());
  const seletor = useRef<HTMLInputElement>(null);
  const proximo = useRef(0);

  async function receber(arquivos: File[]) {
    for (const arquivo of arquivos) {
      if (!ACEITOS.includes(arquivo.type)) {
        mostrarAviso({ tipo: "erro", texto: `${arquivo.name || "A imagem"} não entrou: a referência precisa ser PNG, JPEG ou WebP.` });
        continue;
      }
      if (arquivo.size > MAXIMO) {
        mostrarAviso({ tipo: "erro", texto: `${arquivo.name || "A imagem"} não entrou: passa de 10 MB.` });
        continue;
      }
      const item = { id: proximo.current++, url: URL.createObjectURL(arquivo) };
      setEnviando((e) => [item, ...e]);
      apiReferencias
        .enviar(arquivo)
        .then(recarregar)
        .catch((e: Error) => mostrarAviso({ tipo: "erro", texto: `Não deu para guardar a referência. ${e.message}` }))
        .finally(() => {
          setEnviando((e) => e.filter((x) => x.id !== item.id));
          URL.revokeObjectURL(item.url);
        });
    }
  }
  useImperativeHandle(ref, () => ({ receber: (arquivos) => void receber(arquivos) }));

  async function remover(r: ReferenciaDaApi) {
    setRemovidas((s) => new Set(s).add(r.id));
    try {
      await apiReferencias.remover(r.id);
    } catch (e) {
      setRemovidas((s) => new Set([...s].filter((id) => id !== r.id)));
      mostrarAviso({ tipo: "erro", texto: `Não deu para remover a referência. ${(e as Error).message}` });
      return;
    }
    const chave = pilhaDeDesfazer.empilhar(async () => {
      await apiReferencias.restaurar(r.id);
      setRemovidas((s) => new Set([...s].filter((id) => id !== r.id)));
      recarregar();
    });
    mostrarAviso({ tipo: "desfazivel", chave, texto: "Referência removida." });
  }

  const lista = carga.estado === "pronto" ? carga.dados.filter((r) => !removidas.has(r.id)) : [];

  return (
    <section aria-labelledby="titulo-referencias" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id="titulo-referencias" className="text-[15px] font-semibold">
          Referências
        </h2>
        <p className="text-[13px] text-pretty text-tinta-3">Cole ou arraste imagens que te inspiram. O Chefe segue o que elas têm de bom ao gerar arte, sem copiar.</p>
        <input
          ref={seletor}
          type="file"
          accept={ACEITOS.join(",")}
          multiple
          hidden
          onChange={(e) => {
            void receber(imagensDe(e.currentTarget.files));
            e.currentTarget.value = "";
          }}
        />
      </div>

      <p role="status" className="sr-only">
        {enviando.length ? `Lendo ${enviando.length === 1 ? "1 imagem" : `${enviando.length} imagens`}` : ""}
      </p>

      {carga.estado === "erro" ? (
        <Falha texto="Não deu para carregar as referências." erro={carga.erro} tentar={recarregar} />
      ) : (
        <div
          data-soltando={soltando || undefined}
          className="rounded-cartao border border-dashed border-transparent transition-colors duration-150 data-soltando:border-tinta-3 data-soltando:bg-hover"
        >
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3 sm:grid-cols-[repeat(auto-fill,minmax(136px,1fr))]">
              <li>
                <button
                  type="button"
                  aria-label="Adicionar referência"
                  title="Adicionar referência"
                  onClick={() => seletor.current?.click()}
                  className="pressiona flex aspect-square w-full cursor-pointer items-center justify-center rounded-item border border-dashed border-linha-forte text-tinta-3 hover:border-tinta-3 hover:bg-hover hover:text-tinta"
                >
                  <svg aria-hidden="true" width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                    <path d="M11 4v14M4 11h14" />
                  </svg>
                </button>
              </li>
              {enviando.map((e) => (
                <li key={`enviando-${e.id}`} className="flex flex-col gap-1.5">
                  <div className="relative aspect-square overflow-hidden rounded-item bg-painel outline-1 -outline-offset-1 outline-linha">
                    <img src={e.url} alt="" className="size-full object-cover opacity-50" />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 px-2 pt-4 pb-1.5 text-[11px] font-medium text-white">Lendo…</span>
                  </div>
                </li>
              ))}
              {lista.map((r) => (
                <li key={r.id} className="group relative flex flex-col gap-1.5">
                  <a href={apiReferencias.imagem(r)} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-item bg-painel outline-1 -outline-offset-1 outline-linha">
                    <img src={apiReferencias.imagem(r)} alt={r.leitura} loading="lazy" className="size-full object-cover" />
                  </a>
                  <p title={r.leitura} className="line-clamp-2 text-xs/snug text-pretty text-tinta-3">
                    {r.leitura}
                  </p>
                  <button
                    type="button"
                    aria-label="Remover referência"
                    onClick={() => void remover(r)}
                    className="pressiona absolute top-1.5 right-1.5 flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                  >
                    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
        </div>
      )}
    </section>
  );
}
