import { useEffect } from "react";
import type { ResumoDoUso } from "../../domain/uso";
import { useApi } from "../api";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { ChaveDaIa } from "../componentes/ChaveDaIa";
import { Falha } from "../componentes/Falha";
import { dolar, dolarFino, SaldoDetalhado } from "../componentes/Saldo";

const numero = new Intl.NumberFormat("pt-BR");
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const nomeDoMes = (mes: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-15T12:00:00Z`));
const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

function Numero({ rotulo, valor, texto }: { rotulo: string; valor: number; texto?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-cartao bg-painel px-3 py-3 sm:px-4">
      <span className="text-xs text-tinta-3">{rotulo}</span>
      <span className="tabular truncate text-xl/tight font-semibold tracking-[-0.02em] sm:text-2xl/tight" title={texto ?? numero.format(valor)}>
        {texto ?? compacto.format(valor)}
      </span>
    </div>
  );
}

const dataDoPost = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", timeZone: "America/Sao_Paulo" });

/** O custo de cada post: tudo o que a conversa gastou enquanto ele estava em andamento, do brief ao story. */
function PorPost({ media, posts }: { media: number | null; posts: ResumoDoUso["porPost"] }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 className="text-sm font-medium">Custo por post</h2>
        {media !== null && <span className="tabular text-sm text-tinta-2">Média do mês {dolarFino(media)}</span>}
      </div>
      {posts.length === 0 ? (
        <p className="text-sm text-tinta-3">O custo aparece a partir do próximo post criado numa conversa.</p>
      ) : (
        <ul className="flex flex-col text-sm">
          {posts.map((p) => (
            <li key={p.postId} className="flex min-h-10 items-center gap-3 border-b border-linha py-2 last:border-0">
              <span className="min-w-0 flex-1 truncate">{p.headline ?? "Post sem headline"}</span>
              <span className="tabular hidden text-tinta-3 min-[420px]:inline">
                {p.imagens} {p.imagens === 1 ? "imagem" : "imagens"} · {dataDoPost.format(p.em).replace(".", "")}
              </span>
              <span className="tabular w-20 text-right">{dolarFino(p.custo)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Tokens por dia nos últimos 30 dias, em barras. As imagens ficam no título de cada barra. */
function PorDia({ dias }: { dias: ResumoDoUso["porDia"] }) {
  const maior = Math.max(1, ...dias.map((d) => d.entrada + d.saida));
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium">Tokens por dia, últimos 30 dias</figcaption>
      <div role="img" aria-label="Tokens por dia nos últimos 30 dias" className="flex h-28 items-end gap-[3px]">
        {dias.map((d) => {
          const total = d.entrada + d.saida;
          return (
            <div
              key={d.dia}
              title={`${diaCurto(d.dia)}: ${numero.format(total)} tokens, ${numero.format(d.imagens)} imagens`}
              className="min-w-0 flex-1 rounded-t-[3px] bg-trabalhando"
              style={{ height: `${Math.max(total > 0 ? 4 : 1, (total / maior) * 100)}%`, opacity: total > 0 ? 1 : 0.25 }}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-tinta-3 tabular">
        <span>{diaCurto(dias[0]!.dia)}</span>
        <span>{diaCurto(dias.at(-1)!.dia)}</span>
      </div>
    </figure>
  );
}

function Tabela({
  titulo,
  coluna,
  linhas,
}: {
  titulo: string;
  coluna: string;
  linhas: { nome: string; chamadas: number; entrada: number; saida: number; imagens: number; custo: number }[];
}) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{titulo}</h2>
      {linhas.length === 0 ? (
        <p className="text-sm text-tinta-3">Nada neste mês ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-tinta-3">
              <tr className="border-b border-linha">
                <th className="py-2 pr-3 font-normal">{coluna}</th>
                <th className="py-2 pr-3 text-right font-normal">Custo</th>
                <th className="py-2 pr-3 text-right font-normal">Chamadas</th>
                <th className="py-2 pr-3 text-right font-normal">Entrada</th>
                <th className="py-2 pr-3 text-right font-normal">Saída</th>
                <th className="py-2 text-right font-normal">Imagens</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {linhas.map((l) => (
                <tr key={l.nome} className="border-b border-linha last:border-0">
                  <td className="py-2 pr-3">{l.nome}</td>
                  <td className="py-2 pr-3 text-right">{dolarFino(l.custo)}</td>
                  <td className="py-2 pr-3 text-right">{numero.format(l.chamadas)}</td>
                  <td className="py-2 pr-3 text-right">{numero.format(l.entrada)}</td>
                  <td className="py-2 pr-3 text-right">{numero.format(l.saida)}</td>
                  <td className="py-2 text-right">{numero.format(l.imagens)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Uso({ abrirMenu }: { abrirMenu: () => void }) {
  useEffect(() => {
    document.title = "Uso da API · EM Marketing";
  }, []);
  const [carga, tentar] = useApi<ResumoDoUso>("/api/uso", 30000);

  return (
    <main id="conteudo" className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[880px] flex-col gap-6 px-4 pt-3 pb-10 sm:px-6 md:pt-10">
        <header className="flex items-center gap-2.5">
          <BotaoMenu abrir={abrirMenu} />
          <h1 className="text-2xl/tight font-semibold tracking-[-0.02em]">Uso da API</h1>
        </header>

        <ChaveDaIa />

        <SaldoDetalhado />

        {carga.estado === "carregando" ? (
          <p className="text-sm text-tinta-3">Carregando o uso…</p>
        ) : carga.estado === "erro" ? (
          <Falha texto="Não deu para carregar o uso." erro={carga.erro} tentar={tentar} />
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium first-letter:uppercase">{nomeDoMes(carga.dados.mes)}</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Numero rotulo="Custo" valor={carga.dados.totalDoMes.custo} texto={dolar.format(carga.dados.totalDoMes.custo)} />
                <Numero rotulo="Chamadas" valor={carga.dados.totalDoMes.chamadas} />
                <Numero rotulo="Tokens" valor={carga.dados.totalDoMes.entrada + carga.dados.totalDoMes.saida} />
                <Numero rotulo="Imagens" valor={carga.dados.totalDoMes.imagens} />
              </div>
            </section>
            <PorPost media={carga.dados.custoMedioPorPost} posts={carga.dados.porPost} />
            <Tabela titulo="Por bot e origem" coluna="Origem" linhas={carga.dados.porOrigem.map(({ origem, ...t }) => ({ nome: origem, ...t }))} />
            <PorDia dias={carga.dados.porDia} />
            <details className="group">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 py-1 text-sm text-tinta-2 hover:text-tinta [&::-webkit-details-marker]:hidden">
                <svg
                  aria-hidden="true"
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="transition-transform duration-300 ease-(--ease-saida) group-open:rotate-90 motion-reduce:transition-none"
                >
                  <path d="M3.5 2l3 3-3 3" />
                </svg>
                Detalhes por modelo
              </summary>
              <div className="mt-4 flex flex-col gap-8">
                <Tabela titulo="Por modelo" coluna="Modelo" linhas={carga.dados.porModelo.map(({ modelo, ...t }) => ({ nome: modelo, ...t }))} />
              </div>
            </details>
          </>
        )}
      </div>
    </main>
  );
}
