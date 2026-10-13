import { useEffect, useRef, useState } from "react";
import { useNomesDosBots } from "../api";
import { especialistaDa, passosDe, type ParteDelegacao, type Passo } from "../tipos";
import { Avatar } from "./Avatar";
import { atividadeDe, textoDa } from "./ia/atividade";
import { LinhasDeTarefa, type LinhaDeTarefa } from "./ia/LinhasDeTarefa";
import { Markdown } from "./Markdown";

const relogio = (segundos: number) =>
  segundos < 60 ? `${segundos}s` : `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;

/** Segundos desde que `ativo` virou true, para o relógio da tarefa ao vivo. */
function useCronometro(ativo: boolean) {
  const [segundos, setSegundos] = useState(0);
  useEffect(() => {
    if (!ativo) return;
    const inicio = Date.now();
    const t = setInterval(() => setSegundos(Math.floor((Date.now() - inicio) / 1000)), 1000);
    return () => clearInterval(t);
  }, [ativo]);
  return relogio(segundos);
}

/**
 * Quanto cada passo levou, medido aqui enquanto a tarefa roda. Um passo que já chegou pronto
 * (recarga da página) não tem tempo.
 */
function useTempos() {
  const marcas = useRef(new Map<string, { inicio: number; fim: number | null }>());
  return (id: string, ativo: boolean): string | null => {
    const agora = Date.now();
    let m = marcas.current.get(id);
    if (!m) {
      if (!ativo) return null;
      m = { inicio: agora, fim: null };
      marcas.current.set(id, m);
    }
    if (!ativo) m.fim ??= agora;
    return relogio(Math.floor(((m.fim ?? agora) - m.inicio) / 1000));
  };
}

type Situacao =
  | { tipo: "fila" }
  | { tipo: "trabalhando"; linhas: LinhaDeTarefa[] }
  | { tipo: "concluida"; resumo: string }
  | { tipo: "falhou"; erro: string };

const ROTULO: Record<Situacao["tipo"], { texto: string; cor: string }> = {
  fila: { texto: "Na fila", cor: "text-tinta-3" },
  trabalhando: { texto: "Trabalhando", cor: "text-tinta-3" },
  concluida: { texto: "Terminou", cor: "text-tinta-2" },
  falhou: { texto: "Falhou", cor: "text-erro" },
};

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
  const { nome } = useNomesDosBots()[bot];
  const tempoDe = useTempos();
  const vistas = useRef<LinhaDeTarefa[]>([]);

  const linhaDe = (p: Passo): LinhaDeTarefa => ({ id: p.id, rotulo: p.rotulo, estado: p.estado, tempo: tempoDe(p.id, p.estado === "fazendo") });

  function situacaoDa(p: ParteDelegacao): Situacao {
    if (p.state === "output-error") return { tipo: "falhou", erro: p.errorText };
    if (p.state !== "output-available") return { tipo: "fila" };
    const s = p.output;
    if (s.status === "concluida") return { tipo: "concluida", resumo: s.resumo };
    if (s.status === "falhou") return { tipo: "falhou", erro: s.erro };
    if (s.status === "na_fila") return { tipo: "fila" };
    const atividade = atividadeDe(s.mensagem, true);
    const linhas = passosDe(s.mensagem).map(linhaDe);
    // Fora de uma tool o especialista está pensando ou escrevendo; isso vira a linha ativa.
    if (atividade.tipo !== "usando")
      linhas.push({ id: `agora-${linhas.length}`, rotulo: textoDa(atividade), estado: "fazendo", tempo: tempoDe(`agora-${linhas.length}`, true) });
    return { tipo: "trabalhando", linhas };
  }

  const situacao = situacaoDa(parte);
  const tempo = useCronometro(situacao.tipo === "trabalhando");
  const tarefaId = tarefaIdDa(parte);

  // O resultado final da tool não traz a mensagem; os passos vistos ao vivo ficam, assentados.
  if (situacao.tipo === "trabalhando") vistas.current = situacao.linhas;
  const linhas: LinhaDeTarefa[] =
    situacao.tipo === "trabalhando"
      ? situacao.linhas
      : situacao.tipo === "fila"
        ? []
        : vistas.current
            .filter((l) => !l.id.startsWith("agora-"))
            .map((l) => (l.estado === "fazendo" ? { ...l, estado: situacao.tipo === "falhou" ? "falhou" : "feito", tempo: tempoDe(l.id, false) } : l));

  return (
    <section aria-label={`Tarefa de ${nome}`} className="overflow-hidden rounded-cartao border border-linha bg-superficie text-sm/normal">
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <Avatar bot={bot} tamanho={22} estado={situacao.tipo === "trabalhando" ? "trabalhando" : "parado"} />
        <span className="font-medium">{nome}</span>
        <span aria-live="polite" className={`min-w-0 truncate ${ROTULO[situacao.tipo].cor}`}>
          {ROTULO[situacao.tipo].texto}
        </span>
        {situacao.tipo === "trabalhando" && <span className="tabular font-mono text-xs text-tinta-3">{tempo}</span>}
        {tarefaId && (
          <button
            type="button"
            aria-expanded={aberta}
            data-abre-tarefa={tarefaId}
            onClick={(e) => abrir(tarefaId, e.currentTarget)}
            className="pressiona relative ml-auto flex-none cursor-pointer rounded-full bg-linha px-3 py-1.5 text-[13px] font-medium transition-colors duration-150 after:absolute after:-inset-1.5 hover:bg-linha-forte"
          >
            Ver trabalho
          </button>
        )}
      </div>
      <LinhasDeTarefa linhas={linhas} className="border-t border-linha" />
      {situacao.tipo === "concluida" && (
        <div className="border-t border-linha px-3.5 py-3">
          <div className="line-clamp-4 text-tinta-2">
            <Markdown texto={situacao.resumo} className="block [&>*+*]:mt-1.5" />
          </div>
        </div>
      )}
      {situacao.tipo === "falhou" && <p className="border-t border-linha px-3.5 py-3 text-erro">{situacao.erro}</p>}
    </section>
  );
}
