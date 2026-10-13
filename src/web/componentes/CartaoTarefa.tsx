import { useEffect, useState } from "react";
import { BOTS } from "../bots";
import { passoAtual } from "../equipe";
import { especialistaDa, passosDe, type ParteDelegacao } from "../tipos";
import { Avatar } from "./Avatar";
import { Markdown } from "./Markdown";
import { Passos } from "./Passos";

/** Segundos desde que `ativo` virou true, para o relógio da tarefa ao vivo. */
function useCronometro(ativo: boolean) {
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    if (!ativo) return;
    const inicio = Date.now();
    const t = setInterval(() => setSegundos(Math.floor((Date.now() - inicio) / 1000)), 1000);
    return () => clearInterval(t);
  }, [ativo]);
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

type Situacao =
  { tipo: "fila" } | { tipo: "trabalhando"; passo: string } | { tipo: "concluida"; resumo: string } | { tipo: "falhou"; erro: string };

function situacaoDa(p: ParteDelegacao): Situacao {
  if (p.state === "output-error") return { tipo: "falhou", erro: p.errorText };
  if (p.state !== "output-available") return { tipo: "fila" };
  const s = p.output;
  if (s.status === "concluida") return { tipo: "concluida", resumo: s.resumo };
  if (s.status === "falhou") return { tipo: "falhou", erro: s.erro };
  if (s.status === "na_fila") return { tipo: "fila" };
  return { tipo: "trabalhando", passo: passoAtual(p) ?? "Pensando" };
}

export const tarefaIdDa = (p: ParteDelegacao) => (p.state === "output-available" ? p.output.tarefaId : null);

export function CartaoTarefa({
  parte,
  aberta,
  abrir,
}: {
  parte: ParteDelegacao;
  aberta: boolean;
  abrir: (tarefaId: string, origem: HTMLElement) => void;
}) {
  const bot = especialistaDa(parte);
  const { nome } = BOTS[bot];
  const situacao = situacaoDa(parte);
  const tempo = useCronometro(situacao.tipo === "trabalhando");
  const tarefaId = tarefaIdDa(parte);
  const passos =
    parte.state === "output-available" && parte.output.status === "trabalhando" ? passosDe(parte.output.mensagem).slice(-4) : [];

  return (
    <section aria-label={`Tarefa do ${nome}`} className="overflow-hidden rounded-cartao border border-linha bg-superficie text-sm/normal">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <Avatar bot={bot} tamanho={22} estado={situacao.tipo === "trabalhando" ? "trabalhando" : "parado"} />
        <span className="font-medium">{nome}</span>
        <span aria-live="polite" className="min-w-0 truncate">
          {situacao.tipo === "trabalhando" ? (
            <span className="brilho">{situacao.passo}</span>
          ) : situacao.tipo === "fila" ? (
            <span className="text-tinta-3">Na fila</span>
          ) : situacao.tipo === "concluida" ? (
            <span className="text-tinta-2">Terminou</span>
          ) : (
            <span className="text-erro">Falhou</span>
          )}
        </span>
        {situacao.tipo === "trabalhando" && <span className="tabular font-mono text-xs text-tinta-4">{tempo}</span>}
        {tarefaId && (
          <button
            type="button"
            aria-expanded={aberta}
            onClick={(e) => abrir(tarefaId, e.currentTarget)}
            className="pressiona relative ml-auto flex-none cursor-pointer rounded-full bg-linha px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 after:absolute after:-inset-1.5 hover:bg-linha-forte"
          >
            Ver trabalho
          </button>
        )}
      </div>
      {passos.length > 0 && <Passos passos={passos} className="px-3.5 pt-1 pb-3 pl-11" />}
      {situacao.tipo === "concluida" && (
        <div className="px-3.5 pb-3 pl-11">
          <div className="line-clamp-4 text-tinta-2">
            <Markdown texto={situacao.resumo} className="block [&>*+*]:mt-1.5" />
          </div>
        </div>
      )}
      {situacao.tipo === "falhou" && <p className="px-3.5 pb-3 pl-11 text-erro">{situacao.erro}</p>}
    </section>
  );
}
