import { useEffect } from "react";
import type { ResumoDoUso } from "../../domain/uso";
import { useApi } from "../api";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { Falha } from "../componentes/Falha";

const numero = new Intl.NumberFormat("pt-BR");
const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const nomeDoMes = (mes: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-15T12:00:00Z`));
const diaCurto = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

function Numero({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-cartao bg-painel px-4 py-3">
      <span className="text-xs text-tinta-3">{rotulo}</span>
      <span className="tabular text-2xl/tight font-semibold tracking-[-0.02em]" title={numero.format(valor)}>
        {compacto.format(valor)}
      </span>
    </div>
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

function Tabela({ titulo, coluna, linhas }: { titulo: string; coluna: string; linhas: { nome: string; chamadas: number; entrada: number; saida: number; imagens: number }[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium">{titulo}</h2>
      {linhas.length === 0 ? (
        <p className="text-sm text-tinta-3">Nada neste mês ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead className="text-left text-xs text-tinta-3">
              <tr className="border-b border-linha">
                <th className="py-2 pr-3 font-normal">{coluna}</th>
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
      <div className="mx-auto flex max-w-[880px] flex-col gap-8 px-4 pt-3 pb-10 sm:px-6 md:pt-10">
        <header className="flex flex-col gap-1">
          <div className="flex items-center gap-2.5">
            <BotaoMenu abrir={abrirMenu} />
            <h1 className="text-2xl/tight font-semibold tracking-[-0.02em]">Uso da API</h1>
          </div>
          <p className="text-sm text-tinta-3">
            Tokens e imagens que os bots e o estúdio gastaram, da equipe toda. O valor em dinheiro fica no{" "}
            <a href="https://platform.openai.com/usage" target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-tinta">
              painel da OpenAI
            </a>
            .
          </p>
        </header>

        {carga.estado === "carregando" ? (
          <p className="text-tinta-3">Carregando…</p>
        ) : carga.estado === "erro" ? (
          <Falha texto="Não deu para carregar o uso." erro={carga.erro} tentar={tentar} />
        ) : (
          <>
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-medium first-letter:uppercase">{nomeDoMes(carga.dados.mes)}</h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Numero rotulo="Chamadas" valor={carga.dados.totalDoMes.chamadas} />
                <Numero rotulo="Tokens de entrada" valor={carga.dados.totalDoMes.entrada} />
                <Numero rotulo="Tokens de saída" valor={carga.dados.totalDoMes.saida} />
                <Numero rotulo="Imagens geradas" valor={carga.dados.totalDoMes.imagens} />
              </div>
            </section>
            <PorDia dias={carga.dados.porDia} />
            <Tabela titulo="Por modelo" coluna="Modelo" linhas={carga.dados.porModelo.map(({ modelo, ...t }) => ({ nome: modelo, ...t }))} />
            <Tabela titulo="Por origem" coluna="Origem" linhas={carga.dados.porOrigem.map(({ origem, ...t }) => ({ nome: origem, ...t }))} />
          </>
        )}
      </div>
    </main>
  );
}
