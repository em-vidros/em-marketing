import { useState } from "react";
import type { Saldo } from "../../domain/saldo";
import { ErroDeApi, useApi } from "../api";

export const dolar = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const data = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Sao_Paulo" });
const nomeDoMes = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" });

export const useSaldo = () => useApi<Saldo>("/api/saldo", 5 * 60_000);

/** A fração que ainda resta, de 0 a 1. Abaixo de 20% a barra fica âmbar; abaixo de 5%, vermelha. */
function Barra({ restante, alta = false }: { restante: number; alta?: boolean }) {
  const cor = restante < 0.05 ? "bg-erro" : restante < 0.2 ? "bg-esperando" : "bg-trabalhando";
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(restante * 100)}
      aria-label="Crédito disponível"
      className={`w-full overflow-hidden rounded-full bg-linha-forte ${alta ? "h-3" : "h-1.5"}`}
    >
      <div className={`h-full rounded-full ${cor} transition-[width] duration-500 ease-out`} style={{ width: `${Math.max(restante > 0 ? 2 : 0, restante * 100)}%` }} />
    </div>
  );
}

const restanteDe = (s: Extract<Saldo, { estado: "ok" }>) => (s.carregado > 0 ? s.disponivel / s.carregado : 0);

/** O que a barra diz quando não tem o gasto para medir. */
function aviso(s: Saldo): string | null {
  if (s.estado === "sem-saldo") return "Saldo ainda não definido";
  if (s.estado === "sem-chave") return "Falta a chave de admin da OpenAI";
  if (s.estado === "erro") return "Não deu para ler o gasto";
  return null;
}

/** A versão da barra lateral: a barra e quanto resta, numa linha. */
export function SaldoCompacto() {
  const [carga] = useSaldo();
  const s: Saldo | null = carga.estado === "pronto" ? carga.dados : null;
  return (
    <span className="flex w-full flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-tinta-2">Crédito da OpenAI</span>
        {s?.estado === "ok" && <span className="tabular text-tinta">{dolar.format(s.disponivel)}</span>}
      </span>
      {s?.estado === "ok" ? <Barra restante={restanteDe(s)} /> : s ? <span className="text-xs text-tinta-3">{aviso(s)}</span> : <Barra restante={0} />}
    </span>
  );
}

/** A versão da tela de uso: barra alta, os três valores e o campo para gravar o saldo novo. */
export function SaldoDetalhado() {
  const [carga, recarregar] = useSaldo();
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvar(e: { preventDefault(): void }) {
    e.preventDefault();
    const carregado = Number(valor.replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(carregado) || carregado < 0) return setErro("Digite o saldo em dólar, como 50 ou 12,40.");
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/saldo", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ carregado }) });
      if (!res.ok) throw new ErroDeApi(res.status, ((await res.json().catch(() => null)) as { erro?: string } | null)?.erro ?? `Erro ${res.status}`);
      setValor("");
      recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para salvar o saldo.");
    } finally {
      setSalvando(false);
    }
  }

  const s = carga.estado === "pronto" ? carga.dados : null;
  return (
    <section className="flex flex-col gap-4 rounded-cartao bg-painel p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-tinta-3">Disponível na OpenAI</span>
          <span className="tabular text-3xl/tight font-semibold tracking-[-0.02em]">
            {s?.estado === "ok" ? dolar.format(s.disponivel) : "—"}
          </span>
        </div>
        {s && s.estado !== "sem-saldo" && (
          <span className="tabular text-sm text-tinta-2">
            {s.estado === "ok" && `${dolar.format(s.gasto)} gastos de `}
            {dolar.format(s.carregado)} carregados em {data.format(s.desde)}
          </span>
        )}
      </div>
      {s?.estado === "ok" ? <Barra restante={restanteDe(s)} alta /> : <Barra restante={0} alta />}
      {s?.estado === "ok" && (
        <p className="tabular text-sm text-tinta-2">
          Gasto em {nomeDoMes.format(s.inicioDoMes)}, recargas incluídas: <span className="font-medium text-tinta">{dolar.format(s.gastoDoMes)}</span>
        </p>
      )}
      {s && aviso(s) && (
        <p className="text-sm text-tinta-2">
          {aviso(s)}.{" "}
          {s.estado === "sem-chave" && "Crie uma chave de admin em platform.openai.com/settings/organization/admin-keys e grave como OPENAI_ADMIN_KEY na Vercel."}
          {s.estado === "erro" && s.erro}
          {s.estado === "sem-saldo" && "Digite abaixo o saldo que aparece em platform.openai.com/settings/organization/billing."}
        </p>
      )}
      <form onSubmit={salvar} className="flex flex-wrap items-center gap-2">
        <label htmlFor="saldo-novo" className="text-sm text-tinta-2">
          Saldo atual em dólar
        </label>
        <input
          id="saldo-novo"
          inputMode="decimal"
          placeholder="50,00"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          className="h-9 w-28 rounded-[9px] bg-superficie px-2.5 text-base tabular shadow-[inset_0_0_0_1px_var(--color-borda-campo)] outline-none sm:text-sm"
        />
        <button
          type="submit"
          disabled={salvando || !valor.trim()}
          className="pressiona h-9 cursor-pointer rounded-full bg-tinta px-4 text-sm font-medium text-sobre-tinta disabled:cursor-default disabled:opacity-40"
        >
          {salvando ? "Salvando…" : "Atualizar saldo"}
        </button>
        {erro && (
          <span role="alert" className="text-sm text-erro">
            {erro}
          </span>
        )}
      </form>
      <p className="text-xs text-tinta-3">Ao recarregar crédito na OpenAI, grave o saldo novo aqui. O gasto passa a contar a partir desse momento.</p>
      {s && s.estado !== "sem-saldo" && s.historico.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-tinta-2 hover:text-tinta">Saldos gravados ({s.historico.length})</summary>
          <ul className="tabular mt-2 flex flex-col">
            {s.historico.map((h) => (
              <li key={h.desde} className="flex justify-between gap-4 border-b border-linha py-1.5 last:border-0">
                <span>{data.format(h.desde)}</span>
                <span className="min-w-0 flex-1 truncate text-tinta-3">{h.por}</span>
                <span>{dolar.format(h.carregado)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
