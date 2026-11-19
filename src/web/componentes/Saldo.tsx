import { useState } from "react";
import type { Lancamento, Saldo } from "../../domain/saldo";
import { useApi } from "../api";

export const dolar = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const FUSO = "America/Sao_Paulo";
const data = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: FUSO });
const dataCurta = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO });
const nomeDoMes = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: FUSO });
const hoje = () => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(Date.now());

export const useSaldo = () => useApi<Saldo>("/api/saldo", 5 * 60_000);

type ComConta = Exclude<Saldo, { estado: "vazio" }>;

/** A fração que ainda resta, de 0 a 1. Abaixo de 20% a barra fica âmbar; abaixo de 5%, vermelha. */
function Barra({ restante, alta = false }: { restante: number; alta?: boolean }) {
  const cor = restante < 0.05 ? "bg-erro" : restante < 0.2 ? "bg-esperando" : "bg-trabalhando";
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(restante * 100)}
      aria-label="Crédito que sobra"
      className={`w-full overflow-hidden rounded-full bg-linha-forte ${alta ? "h-3" : "h-1.5"}`}
    >
      <div className={`h-full rounded-full ${cor} transition-[width] duration-500 ease-out`} style={{ width: `${Math.max(restante > 0 ? 2 : 0, restante * 100)}%` }} />
    </div>
  );
}

const restanteDe = (s: Extract<Saldo, { estado: "ok" }>) => (s.creditado > 0 ? s.disponivel / s.creditado : 0);

/** A versão da barra lateral: quanto sobra, a barra e o último depósito. */
export function SaldoCompacto() {
  const [carga] = useSaldo();
  const s = carga.estado === "pronto" ? carga.dados : null;
  return (
    <span className="flex w-full flex-col gap-1.5 text-xs">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-tinta-2">Sobra na OpenAI</span>
        <span className="tabular font-medium text-tinta">{s?.estado === "ok" ? dolar.format(s.disponivel) : "—"}</span>
      </span>
      <Barra restante={s?.estado === "ok" ? restanteDe(s) : 0} />
      <span className="tabular truncate text-tinta-3">
        {s && s.estado !== "vazio" && s.ultimoDeposito
          ? `Último depósito ${dolar.format(s.ultimoDeposito.valor)} em ${dataCurta.format(s.ultimoDeposito.em)}`
          : "Nenhum depósito registrado"}
      </span>
    </span>
  );
}

async function pedir(metodo: "PUT" | "DELETE", caminho: string, corpo?: unknown): Promise<void> {
  const res = await fetch(caminho, { method: metodo, headers: { "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { erro?: string } | null)?.erro ?? `Erro ${res.status}`);
}

const lerValor = (texto: string) => Number(texto.trim().replace(/\./g, "").replace(",", "."));

function Numero({ rotulo, valor, detalhe }: { rotulo: string; valor: string; detalhe?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs text-tinta-3">{rotulo}</span>
      <span className="tabular text-3xl/tight font-semibold tracking-[-0.02em]">{valor}</span>
      {detalhe && <span className="tabular text-sm text-tinta-2">{detalhe}</span>}
    </div>
  );
}

/** A versão da tela de uso: quanto sobra, o último depósito, o gasto e o registro de depósitos. */
export function SaldoDetalhado() {
  const [carga, recarregar] = useSaldo();
  const [tipo, setTipo] = useState<Lancamento["tipo"]>("deposito");
  const [valor, setValor] = useState("");
  const [dia, setDia] = useState(hoje);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function rodar(acao: () => Promise<void>) {
    setSalvando(true);
    setErro(null);
    try {
      await acao();
      recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para salvar.");
    } finally {
      setSalvando(false);
    }
  }

  function salvar(e: { preventDefault(): void }) {
    e.preventDefault();
    const n = lerValor(valor);
    if (!Number.isFinite(n) || n <= 0) return setErro("Digite o valor em dólar, como 50 ou 12,40.");
    void rodar(async () => {
      await pedir("PUT", "/api/saldo", tipo === "deposito" ? { tipo, valor: n, dia } : { tipo, valor: n });
      setValor("");
    });
  }

  const s: ComConta | null = carga.estado === "pronto" && carga.dados.estado !== "vazio" ? carga.dados : null;
  const ultimo = s?.ultimoDeposito ?? null;

  return (
    <section className="flex flex-col gap-5 rounded-cartao bg-painel p-4 sm:p-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Numero
          rotulo="Sobra na OpenAI"
          valor={s?.estado === "ok" ? dolar.format(s.disponivel) : "—"}
          detalhe={s?.estado === "ok" ? `${dolar.format(s.gasto)} gastos de ${dolar.format(s.creditado)} desde ${data.format(s.desde)}` : undefined}
        />
        <Numero rotulo="Último depósito" valor={ultimo ? dolar.format(ultimo.valor) : "—"} detalhe={ultimo ? `em ${data.format(ultimo.em)}` : "Nenhum registrado"} />
      </div>
      <Barra restante={s?.estado === "ok" ? restanteDe(s) : 0} alta />
      {s?.estado === "ok" && (
        <p className="tabular text-sm text-tinta-2">
          Gasto em {nomeDoMes.format(s.inicioDoMes)}: <span className="font-medium text-tinta">{dolar.format(s.gastoDoMes)}</span>
        </p>
      )}
      {!s && carga.estado === "pronto" && (
        <p className="text-sm text-tinta-2">Registre o último depósito, ou o saldo de hoje que aparece em platform.openai.com/settings/organization/billing, para a conta começar.</p>
      )}
      {s?.estado === "sem-chave" && <p className="text-sm text-tinta-2">Falta a chave de admin da OpenAI (OPENAI_ADMIN_KEY) para medir o gasto.</p>}
      {s?.estado === "erro" && <p className="text-sm text-erro">Não deu para ler o gasto: {s.erro}</p>}

      <form onSubmit={salvar} className="flex flex-col gap-2.5 border-t border-linha pt-4">
        <div className="flex gap-1 text-sm" role="radiogroup" aria-label="O que registrar">
          {(
            [
              ["deposito", "Registrar depósito"],
              ["saldo", "Corrigir o saldo de hoje"],
            ] as const
          ).map(([t, rotulo]) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={tipo === t}
              onClick={() => setTipo(t)}
              className={`h-8 cursor-pointer rounded-full px-3 ${tipo === t ? "bg-tinta text-sobre-tinta" : "text-tinta-2 hover:bg-hover hover:text-tinta"}`}
            >
              {rotulo}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-tinta-2">
            Valor em dólar
            <input
              inputMode="decimal"
              placeholder="50,00"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
              className="h-9 w-28 rounded-[9px] bg-superficie px-2.5 text-base tabular text-tinta shadow-[inset_0_0_0_1px_var(--color-borda-campo)] outline-none sm:text-sm"
            />
          </label>
          {tipo === "deposito" && (
            <label className="flex items-center gap-2 text-sm text-tinta-2">
              Dia
              <input
                type="date"
                value={dia}
                max={hoje()}
                onChange={(e) => setDia(e.target.value)}
                className="h-9 rounded-[9px] bg-superficie px-2.5 text-base tabular text-tinta shadow-[inset_0_0_0_1px_var(--color-borda-campo)] outline-none sm:text-sm"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={salvando || !valor.trim()}
            className="pressiona h-9 cursor-pointer rounded-full bg-tinta px-4 text-sm font-medium text-sobre-tinta disabled:cursor-default disabled:opacity-40"
          >
            {salvando ? "Salvando…" : "Salvar"}
          </button>
          {erro && (
            <span role="alert" className="text-sm text-erro">
              {erro}
            </span>
          )}
        </div>
        <p className="text-xs text-tinta-3">
          A OpenAI não deixa ler depósitos pela API: registre cada recarga aqui. Corrigir o saldo recomeça a conta com o valor de hoje.
        </p>
      </form>

      {s && s.lancamentos.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-tinta-2 hover:text-tinta">Depósitos e correções ({s.lancamentos.length})</summary>
          <ul className="tabular mt-2 flex flex-col">
            {s.lancamentos.map((l) => (
              <li key={l.em} className="flex items-center gap-3 border-b border-linha py-1.5 last:border-0">
                <span className="w-24 flex-none">{data.format(l.em)}</span>
                <span className="w-20 flex-none text-tinta-2">{l.tipo === "deposito" ? "Depósito" : "Saldo"}</span>
                <span className="min-w-0 flex-1 truncate text-tinta-3">{l.por}</span>
                <span className="flex-none">{dolar.format(l.valor)}</span>
                <button
                  type="button"
                  aria-label={`Apagar ${l.tipo === "deposito" ? "depósito" : "saldo"} de ${data.format(l.em)}`}
                  disabled={salvando}
                  onClick={() => void rodar(() => pedir("DELETE", `/api/saldo/${l.em}`))}
                  className="grid size-7 flex-none cursor-pointer place-items-center rounded-full text-tinta-3 hover:bg-hover hover:text-tinta"
                >
                  <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <path d="M2 2l6 6M8 2L2 8" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
