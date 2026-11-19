import type { Saldo } from "../../domain/saldo";
import { useApi } from "../api";

export const dolar = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
const FUSO = "America/Sao_Paulo";
const data = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: FUSO });
const dataCurta = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO });
const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });

type Lido = Extract<Saldo, { estado: "ok" }>;

export const useSaldo = () => useApi<Saldo>("/api/saldo", 5 * 60_000);

const restanteDe = (s: Lido) => (s.depositado > 0 ? s.disponivel / s.depositado : 0);

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
      className={`w-full overflow-hidden rounded-full bg-linha-forte ${alta ? "h-2" : "h-1.5"}`}
    >
      <div className={`h-full rounded-full ${cor} transition-[width] duration-500 ease-out`} style={{ width: `${Math.max(restante > 0 ? 2 : 0, restante * 100)}%` }} />
    </div>
  );
}

function aviso(s: Saldo): string | null {
  if (s.estado === "sem-chave") return "Falta conectar a conta da OpenAI (OPENAI_SESSION_KEY).";
  if (s.estado === "erro") return `A OpenAI não respondeu: ${s.erro}. Se a sessão caiu, gere uma chave nova.`;
  return null;
}

/** A versão da barra lateral: quanto sobra, a barra e o último depósito. */
export function SaldoCompacto() {
  const [carga] = useSaldo();
  const s = carga.estado === "pronto" && carga.dados.estado === "ok" ? carga.dados : null;
  const ultimo = s?.depositos[0];
  return (
    <span className="flex w-full flex-col gap-1.5 text-xs">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-tinta-2">Sobra na OpenAI</span>
        <span className="tabular font-medium text-tinta">{s ? dolar.format(s.disponivel) : "—"}</span>
      </span>
      <Barra restante={s ? restanteDe(s) : 0} />
      <span className="tabular truncate text-tinta-3">
        {ultimo ? `Último depósito ${dolar.format(ultimo.valor)} em ${dataCurta.format(ultimo.em)}` : carga.estado === "pronto" ? "Saldo indisponível" : "Lendo o saldo…"}
      </span>
    </span>
  );
}

/** A versão da tela de uso: quanto sobra, o último depósito e os depósitos anteriores. */
export function SaldoDetalhado() {
  const [carga] = useSaldo();
  if (carga.estado !== "pronto") {
    return <section aria-busy="true" className="h-[188px] rounded-cartao bg-painel" />;
  }
  const s = carga.dados;
  if (s.estado !== "ok") {
    return (
      <section role="alert" className="rounded-cartao bg-painel p-4 text-sm text-erro sm:p-5">
        {aviso(s)}
      </section>
    );
  }
  const [ultimo, ...anteriores] = s.depositos;

  return (
    <section className="flex flex-col gap-4 rounded-cartao bg-painel p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-tinta-2">Sobra na OpenAI</span>
          <span className="tabular text-4xl/none font-semibold tracking-[-0.03em]">{dolar.format(s.disponivel)}</span>
        </div>
        {ultimo && (
          <div className="flex flex-col gap-1 sm:items-end">
            <span className="text-sm text-tinta-2">Último depósito</span>
            <span className="tabular text-xl/none font-semibold">{dolar.format(ultimo.valor)}</span>
            <span className="tabular text-sm text-tinta-3">{data.format(ultimo.em)}</span>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Barra restante={restanteDe(s)} alta />
        <div className="tabular flex justify-between gap-3 text-xs text-tinta-3">
          <span>
            {dolar.format(s.usado)} usados de {dolar.format(s.depositado)}
          </span>
          <span>Atualizado às {hora.format(s.lidoEm)}</span>
        </div>
      </div>
      {anteriores.length > 0 && (
        <ul className="tabular flex flex-col border-t border-linha pt-2 text-sm">
          {anteriores.map((d) => (
            <li key={d.em} className="flex justify-between gap-3 py-1.5 text-tinta-2">
              <span>{data.format(d.em)}</span>
              <span>{dolar.format(d.valor)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
