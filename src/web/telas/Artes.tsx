import { useEffect } from "react";
import type { Formato } from "../../v2/camadas";
import { apiArtes, useApi, type ArteDaApi } from "../api";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { Falha } from "../componentes/Falha";
import { dia } from "../componentes/peca";
import { aoClicarLink } from "../rota";

const PROPORCAO: Record<Formato, string> = { feed: "aspect-[4/5]", story: "aspect-[9/16]" };

export const tituloDa = (arte: ArteDaApi) => arte.camadas.find((c) => c.tipo === "texto")?.texto ?? "Arte sem texto";

export function Artes({ abrirMenu }: { abrirMenu: () => void }) {
  useEffect(() => {
    document.title = "Artes · EM Marketing";
  }, []);
  const [carga, tentar] = useApi<ArteDaApi[]>("/api/artes");

  return (
    <main id="conteudo" className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-4 pt-3 pb-10 sm:px-6 md:pt-10">
        <header className="flex items-center gap-2.5">
          <BotaoMenu abrir={abrirMenu} />
          <h1 className="text-2xl/tight font-semibold tracking-[-0.02em]">Artes</h1>
        </header>

        {carga.estado === "carregando" ? (
          <p className="text-tinta-3">Carregando…</p>
        ) : carga.estado === "erro" ? (
          <Falha texto="Não deu para carregar as artes." erro={carga.erro} tentar={tentar} />
        ) : carga.dados.length === 0 ? (
          <p className="py-8 text-tinta-3">Nenhuma arte ainda. Peça uma arte ao Chefe e ela aparece aqui.</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(160px,40vw),1fr))] items-end gap-x-4 gap-y-6 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
            {carga.dados.map((arte) => (
              <li key={arte.id}>
                <a href={`/artes/${arte.id}`} onClick={aoClicarLink} className="pressiona-leve group flex flex-col gap-2">
                  <img
                    src={apiArtes.png(arte)}
                    alt=""
                    loading="lazy"
                    className={`w-full rounded-cartao bg-painel object-cover outline-1 -outline-offset-1 outline-linha ${PROPORCAO[arte.formato]}`}
                  />
                  <span className="line-clamp-2 text-sm/snug font-medium text-pretty [overflow-wrap:anywhere]">{tituloDa(arte)}</span>
                  <span className="-mt-1 text-xs text-tinta-3">
                    {arte.formato === "feed" ? "Feed" : "Story"} · <span className="tabular">{dia.format(new Date(arte.criadaEm))}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

