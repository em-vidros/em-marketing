import { useEffect, useState, type SubmitEvent } from "react";
import type { Movimento, Saldo } from "../../domain/saldo";
import { apiSaldo, useApi } from "../api";
import { mostrarAviso } from "./menu/Avisos";
import { pilhaDeDesfazer } from "./menu/desfazer";

export const dolar = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });
/** Abaixo de 10 centavos, o centavo sumiria: US$ 0,047 e US$ 0,0088 ganham casas até mostrar dois dígitos. */
export const dolarFino = (v: number) => {
  const a = Math.abs(v);
  const casas = a === 0 || a >= 0.1 ? 2 : a >= 0.01 ? 3 : 4;
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: casas, maximumFractionDigits: casas }).format(v);
};
const FUSO = "America/Sao_Paulo";
const data = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", timeZone: FUSO });
const dataCurta = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: FUSO });
const quando = (em: number) => data.format(em).replace(".", "");
const PAINEL = "https://platform.openai.com/settings/organization/billing/overview";

type Lido = Extract<Saldo, { estado: "ok" }>;

/** A barra lateral e a tela de uso leem o saldo cada uma; quem muda o saldo avisa as duas. */
const mudancas = new EventTarget();
const avisarMudanca = () => mudancas.dispatchEvent(new Event("mudou"));

export function useSaldo() {
  const [carga, recarregar] = useApi<Saldo>("/api/saldo", 60_000);
  useEffect(() => {
    mudancas.addEventListener("mudou", recarregar);
    return () => mudancas.removeEventListener("mudou", recarregar);
  }, [recarregar]);
  return [carga, avisarMudanca] as const;
}

const restanteDe = (s: Lido) => (s.total > 0 ? Math.max(0, s.disponivel) / s.total : 0);

/** A fração que ainda resta, de 0 a 1. Abaixo de 20% a barra fica âmbar; abaixo de 5%, vermelha. */
function Barra({ restante, alta = false }: { restante: number; alta?: boolean }) {
  const cor = restante < 0.05 ? "bg-erro" : restante < 0.2 ? "bg-esperando" : "bg-trabalhando";
  return (
    <div
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(restante * 100)}
      aria-label="Crédito que resta"
      className={`w-full overflow-hidden rounded-full bg-linha-forte ${alta ? "h-2" : "h-1.5"}`}
    >
      <div className={`h-full rounded-full ${cor} transition-[width] duration-500 ease-out`} style={{ width: `${Math.max(restante > 0 ? 2 : 0, restante * 100)}%` }} />
    </div>
  );
}

/** A versão da barra lateral: quanto sobra, a barra e desde quando o app conta. */
export function SaldoCompacto() {
  const [carga] = useSaldo();
  const s = carga.estado === "pronto" && carga.dados.estado === "ok" ? carga.dados : null;
  return (
    <span className="flex w-full flex-col gap-1.5 text-xs">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-tinta-2">Crédito OpenAI</span>
        <span className={`tabular font-medium ${s && s.disponivel < 0 ? "text-erro" : "text-tinta"}`}>{s ? dolar.format(s.disponivel) : "—"}</span>
      </span>
      <Barra restante={s ? restanteDe(s) : 0} />
      <span className="tabular truncate text-tinta-3">
        {s ? `Estimado desde ${dataCurta.format(s.desde)}` : carga.estado === "pronto" ? "Informe o saldo em Uso da API" : "Lendo o saldo…"}
      </span>
    </span>
  );
}

/** "10,50", "10.50" e "US$ 10,50" valem; null quando não é um valor. */
function lerValor(texto: string): number | null {
  const limpo = texto.replace(/[^\d,.]/g, "");
  const normal = limpo.includes(",") ? limpo.replace(/\./g, "").replace(",", ".") : limpo;
  const n = Number(normal);
  return normal !== "" && Number.isFinite(n) ? n : null;
}

function Informar({ tipo, aoTerminar, cancelar }: { tipo: Movimento["tipo"]; aoTerminar: () => void; cancelar?: () => void }) {
  const [texto, setTexto] = useState("");
  const [recusa, setRecusa] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const valor = lerValor(texto);
  const id = `valor-${tipo}`;

  async function enviar(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (valor === null || enviando) return;
    setEnviando(true);
    try {
      await apiSaldo.informar(tipo, valor);
      setTexto("");
      aoTerminar();
    } catch (erro) {
      setRecusa(erro instanceof Error ? erro.message : String(erro));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm text-tinta-2">
        {tipo === "saldo" ? "Saldo que o painel da OpenAI mostra agora" : "Valor do depósito"}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={cancelar !== undefined}
          placeholder="US$ 0,00"
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value);
            setRecusa(null);
          }}
          aria-invalid={recusa ? true : undefined}
          aria-describedby={`${id}-status`}
          className="tabular h-10 w-36 rounded-item border border-borda-campo bg-superficie px-3 text-sm outline-none focus:border-tinta aria-invalid:border-erro"
        />
        <button type="submit" disabled={valor === null || enviando} className="pressiona h-10 rounded-full bg-tinta px-4 text-sm font-medium text-sobre-tinta disabled:opacity-40">
          {enviando ? "Guardando…" : tipo === "saldo" ? "Guardar saldo" : "Guardar depósito"}
        </button>
        {cancelar && (
          <button type="button" onClick={cancelar} className="pressiona h-10 rounded-full px-3 text-sm text-tinta-2 hover:bg-hover hover:text-tinta">
            Cancelar
          </button>
        )}
      </div>
      <p id={`${id}-status`} role={recusa ? "alert" : undefined} className={`min-h-4 text-xs ${recusa ? "text-erro" : "text-tinta-3"}`}>
        {recusa ?? (texto && valor === null ? "Digite só o valor, como 10,50." : null)}
      </p>
    </form>
  );
}

function Movimentos({ movimentos, recarregar }: { movimentos: Movimento[]; recarregar: () => void }) {
  const [removidos, setRemovidos] = useState<ReadonlySet<string>>(new Set());

  async function remover(m: Movimento) {
    setRemovidos((s) => new Set(s).add(m.id));
    try {
      await apiSaldo.remover(m.id);
    } catch (e) {
      setRemovidos((s) => new Set([...s].filter((id) => id !== m.id)));
      mostrarAviso({ tipo: "erro", texto: `Não deu para remover. ${(e as Error).message}` });
      return;
    }
    recarregar();
    const chave = pilhaDeDesfazer.empilhar(async () => {
      await apiSaldo.restaurar(m.id);
      setRemovidos((s) => new Set([...s].filter((id) => id !== m.id)));
      recarregar();
    });
    mostrarAviso({ tipo: "desfazivel", chave, texto: m.tipo === "saldo" ? "Saldo removido." : "Depósito removido." });
  }

  const lista = movimentos.filter((m) => !removidos.has(m.id));
  if (lista.length === 0) return null;
  return (
    <ul aria-label="Saldos e depósitos informados" className="flex flex-col border-t border-linha pt-1 text-sm">
      {lista.map((m) => (
        <li key={m.id} className="flex min-h-10 items-center gap-3 text-tinta-2">
          <span className="min-w-0 flex-1 py-2">
            {m.tipo === "saldo" ? "Saldo informado" : "Depósito"} <span className="text-tinta-3">em {quando(m.em)} por {m.por.split("@")[0]}</span>
          </span>
          <span className="tabular text-tinta">{dolar.format(m.valor)}</span>
          <button
            type="button"
            onClick={() => void remover(m)}
            aria-label={`Remover ${m.tipo === "saldo" ? "saldo" : "depósito"} de ${dolar.format(m.valor)} de ${quando(m.em)}`}
            className="pressiona grid size-8 place-items-center rounded-full text-tinta-3 hover:bg-hover hover:text-tinta"
          >
            <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A versão da tela de uso: o saldo estimado, o gasto desde o último saldo informado e o que a equipe informou. */
export function SaldoDetalhado() {
  const [carga, recarregar] = useSaldo();
  const [informando, setInformando] = useState<Movimento["tipo"] | null>(null);
  if (carga.estado !== "pronto") {
    return <section aria-busy="true" className="h-[188px] rounded-cartao bg-painel" />;
  }
  const s = carga.dados;

  if (s.estado === "sem-saldo") {
    return (
      <section className="flex flex-col gap-4 rounded-cartao bg-painel p-4 sm:p-5">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">Quanto crédito a OpenAI mostra?</h2>
          <p className="text-sm text-tinta-2">
            A OpenAI não deixa o app ler o saldo. Copie o valor do{" "}
            <a href={PAINEL} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-tinta">
              painel de cobrança
            </a>{" "}
            e o app desconta o custo de cada chamada.
          </p>
        </div>
        <Informar tipo="saldo" aoTerminar={recarregar} />
        <Movimentos movimentos={s.movimentos} recarregar={recarregar} />
      </section>
    );
  }

  const negativo = s.disponivel < 0;
  return (
    <section className="flex flex-col gap-4 rounded-cartao bg-painel p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-tinta-2">Crédito estimado</span>
          <span className={`tabular text-4xl/none font-semibold tracking-[-0.03em] ${negativo ? "text-erro" : ""}`}>{dolar.format(s.disponivel)}</span>
        </div>
        <div className="flex flex-col gap-1 sm:items-end">
          <span className="text-sm text-tinta-2">Gasto desde {quando(s.desde)}</span>
          <span className="tabular text-xl/none font-semibold">{dolarFino(s.gasto)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Barra restante={restanteDe(s)} alta />
        <p className={`text-xs ${negativo ? "text-erro" : "text-tinta-3"}`}>
          {negativo
            ? "O custo medido passou do saldo informado. Confira o painel da OpenAI e corrija o saldo."
            : "O app soma o custo de cada chamada pela tabela de preços. O painel da OpenAI pode diferir em centavos."}
        </p>
      </div>
      {informando ? (
        <Informar key={informando} tipo={informando} aoTerminar={() => (setInformando(null), recarregar())} cancelar={() => setInformando(null)} />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setInformando("deposito")} className="pressiona h-8 rounded-full bg-superficie px-3.5 text-sm font-medium shadow-[0_0_0_1px_var(--color-linha-forte)] hover:bg-hover">
            Registrar depósito
          </button>
          <button type="button" onClick={() => setInformando("saldo")} className="pressiona h-8 rounded-full px-3 text-sm text-tinta-2 hover:bg-hover hover:text-tinta">
            Corrigir saldo
          </button>
          <a href={PAINEL} target="_blank" rel="noreferrer" className="pressiona inline-flex h-8 items-center rounded-full px-3 text-sm text-tinta-2 hover:bg-hover hover:text-tinta">
            Abrir o painel da OpenAI
          </a>
        </div>
      )}
      <Movimentos movimentos={s.movimentos} recarregar={recarregar} />
    </section>
  );
}
