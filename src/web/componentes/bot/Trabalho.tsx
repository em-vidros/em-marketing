import type { UIMessage } from "ai";
import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import type { StatusTarefa, TrabalhoDoBot } from "../../../agent/tarefas";
import { pegar, useApi, useNomesDosBots } from "../../api";
import { aoClicarLink } from "../../rota";
import { imagensEm, passosDe, type BotId, type Conversa, type Fase, type ResumoTarefa, type Tarefa } from "../../tipos";
import { Avatar } from "../Avatar";
import { atividadeDe } from "../ia/atividade";
import { IconeDaFase } from "../ia/LinhaFerramenta";
import { Pensando } from "../ia/Pensando";
import { Chevron, Raciocinio } from "../ia/Raciocinio";
import { Markdown } from "../Markdown";
import { dataCurta } from "../peca";
import { Passos } from "../Passos";

const STATUS: Record<StatusTarefa, { rotulo: string; fase: Fase }> = {
  na_fila: { rotulo: "Na fila", fase: "esperando" },
  trabalhando: { rotulo: "Trabalhando", fase: "fazendo" },
  concluida: { rotulo: "Concluída", fase: "feito" },
  falhou: { rotulo: "Falhou", fase: "falhou" },
};

const ativa = (s: StatusTarefa) => s === "na_fila" || s === "trabalhando";

const segundos = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** "14,3 s", "2 min 5 s", "1 h 3 min", como o "Ran for 14.35 s" do Grok. */
export function duracao(ms: number) {
  const s = Math.max(0, ms / 1000);
  if (s < 60) return `${segundos.format(s)} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.floor(s % 60)} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** O SQLite grava "2026-10-13 18:00:00" em UTC, sem o fuso. */
const daColuna = (s: string) => new Date(`${s.replace(" ", "T")}Z`);

const linkDaConversa = (id: string) => `/c/${encodeURIComponent(id)}`;

function useRelogio(ligado: boolean) {
  const [agora, setAgora] = useState(Date.now);
  useEffect(() => {
    if (!ligado) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ligado]);
  return agora;
}

export function Secao({ titulo, children, acao }: { titulo: string; children: ReactNode; acao?: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-[13px] font-medium text-tinta-3">
          {titulo}
        </h2>
        {acao}
      </div>
      {children}
    </section>
  );
}

export const Vazio = ({ children }: { children: ReactNode }) => <p className="py-2 text-pretty text-tinta-3">{children}</p>;

/** O trabalho do especialista: texto, raciocínio, passos e as artes que as tools devolveram. Só leitura. */
function Transcricao({ tarefa }: { tarefa: Tarefa }) {
  const noAr = tarefa.status === "trabalhando";
  const mensagens = tarefa.mensagens.filter((m) => !(m.role === "user" && textoDe(m) === tarefa.pedido));
  const ultima = mensagens.findLast((m) => m.role === "assistant");
  return (
    <div className="flex flex-col gap-3.5">
      {mensagens.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="max-w-[88%] self-end rounded-[18px] bg-ativo px-3.5 py-2 text-[13px] whitespace-pre-line">
            {textoDe(m)}
          </div>
        ) : (
          <div key={m.id} className="flex flex-col gap-3">
            {m.parts.map((p, i) => {
              const aoVivo = noAr && m === ultima && "state" in p && p.state === "streaming";
              if (p.type === "reasoning") return <Raciocinio key={i} texto={p.text} ativo={aoVivo} />;
              if (p.type === "text")
                return p.text.trim() ? <Markdown key={i} texto={p.text} digitando={aoVivo} className="gap-2.5 text-[13px]/relaxed" /> : null;
              const [passo] = passosDe({ ...m, parts: [p] });
              if (!passo) return null;
              const imagens = passo.estado === "feito" ? imagensEm(passo.saida) : [];
              return (
                <div key={i} className="flex flex-col gap-2">
                  <Passos passos={[passo]} />
                  {imagens.length > 0 && (
                    <div className="grid max-w-md grid-cols-3 gap-2">
                      {imagens.map((src, n) => (
                        <a key={src} href={src} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-item">
                          <img
                            src={src}
                            alt={`Arte ${n + 1}, abre em outra aba`}
                            loading="lazy"
                            className="aspect-[4/5] w-full bg-ativo object-cover outline-1 -outline-offset-1 outline-black/10"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ),
      )}
      {noAr && atividadeDe(ultima, true).tipo === "pensando" && <Pensando />}
      {mensagens.length === 0 && !noAr && <p className="text-[13px] text-tinta-3">Esta tarefa não deixou mensagens.</p>}
    </div>
  );
}

const textoDe = (m: UIMessage) => m.parts.map((p) => (p.type === "text" ? p.text : "")).join("");

/** Relida a cada 2 s enquanto a tarefa roda: o especialista grava o progresso a cada passo. */
function Detalhe({ tarefa }: { tarefa: ResumoTarefa }) {
  const [carga, recarregar] = useApi<Tarefa>(`/api/tarefas/${encodeURIComponent(tarefa.id)}`, ativa(tarefa.status) ? 2000 : undefined);
  useEffect(recarregar, [tarefa.status, recarregar]);
  if (carga.estado === "carregando") return <p className="text-[13px] text-tinta-3">Abrindo a tarefa…</p>;
  if (carga.estado === "erro") return <p className="text-[13px] text-erro">Não deu para abrir esta tarefa. {carga.erro.message}</p>;
  return <Transcricao tarefa={carga.dados} />;
}

/** Uma tarefa numa linha. O botão abre a transcrição ali mesmo; o link ao lado leva à conversa. */
export function LinhaTarefa({ tarefa: t, mostrarBot = false }: { tarefa: ResumoTarefa; mostrarBot?: boolean }) {
  const [aberta, setAberta] = useState(false);
  const painel = useId();
  const nomes = useNomesDosBots();
  const rodando = ativa(t.status);
  const agora = useRelogio(rodando);
  const { rotulo, fase } = STATUS[t.status];
  const tempo = rodando
    ? `${t.status === "na_fila" ? "Na fila há" : "Rodando há"} ${duracao(Math.floor((agora - t.criadaEm) / 1000) * 1000)}`
    : `Rodou por ${duracao(t.atualizadaEm - t.criadaEm)}`;
  const resumo = t.status === "falhou" ? t.erro : t.resumo;

  return (
    <li className="border-t border-linha first:border-t-0">
      <div className="flex items-start gap-1 p-1">
        <button
          type="button"
          aria-expanded={aberta}
          aria-controls={painel}
          onClick={() => setAberta((a) => !a)}
          className="grid min-w-0 flex-1 cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-3 rounded-[12px] px-3 py-2.5 text-left transition-colors duration-150 hover:bg-fundo"
        >
          <span className="grid h-5 place-items-center">
            {mostrarBot ? <Avatar bot={t.botId} tamanho={20} estado={t.status === "trabalhando" ? "trabalhando" : "parado"} anel="var(--color-superficie)" /> : <IconeDaFase fase={fase} />}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="line-clamp-2 font-medium text-pretty">{t.pedido}</span>
            {resumo && (
              <span className={`line-clamp-2 text-[13px] text-pretty ${t.status === "falhou" ? "text-erro" : "text-tinta-2"}`}>{resumo}</span>
            )}
            <span className="tabular text-xs text-tinta-3">
              {[mostrarBot ? nomes[t.botId].nome : null, rotulo, dataCurta.format(t.criadaEm), tempo].filter(Boolean).join(" · ")}
            </span>
          </span>
          <span className="grid h-5 place-items-center">
            <Chevron aberto={aberta} />
          </span>
        </button>
        <a
          href={linkDaConversa(t.conversaId)}
          onClick={aoClicarLink}
          aria-label={`Abrir a conversa deste pedido`}
          title="Abrir a conversa"
          className="pressiona grid size-10 flex-none place-items-center rounded-[12px] text-tinta-3 transition-colors duration-150 hover:bg-fundo hover:text-tinta"
        >
          <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
          </svg>
        </a>
      </div>
      {aberta && (
        <div id={painel} className="sobe border-t border-linha px-4 pt-3.5 pb-4 sm:pl-12">
          <Detalhe tarefa={t} />
        </div>
      )}
    </li>
  );
}

export function ListaDeTarefas({ tarefas, mostrarBot }: { tarefas: readonly ResumoTarefa[]; mostrarBot?: boolean }) {
  return (
    <ul className="flex flex-col overflow-hidden rounded-cartao border border-transparent bg-superficie shadow-[0_0_0_1px_var(--color-linha-forte)]">
      {tarefas.map((t) => (
        <LinhaTarefa key={t.id} tarefa={t} mostrarBot={mostrarBot} />
      ))}
    </ul>
  );
}

const POR_PAGINA = 20;

const juntar = (a: TrabalhoDoBot, b: TrabalhoDoBot): TrabalhoDoBot =>
  a.tipo === "tarefas" && b.tipo === "tarefas"
    ? { ...b, itens: [...a.itens, ...b.itens] }
    : a.tipo === "conversas" && b.tipo === "conversas"
      ? { ...b, itens: [...a.itens, ...b.itens] }
      : b;

type Paginas =
  | { estado: "carregando" }
  | { estado: "erro"; erro: string }
  | { estado: "pronto"; trabalho: TrabalhoDoBot; maisCarregando: boolean; maisErro: string | null };

/** As páginas de /api/bots/:id/tarefas, somadas. `releitura` muda quando uma tarefa termina, e a lista volta à primeira página. */
function useTrabalho(id: BotId, releitura: string) {
  const [p, setP] = useState<Paginas>({ estado: "carregando" });
  const url = (offset: number) => `/api/bots/${id}/tarefas?offset=${offset}&limite=${POR_PAGINA}`;

  useEffect(() => {
    const ctl = new AbortController();
    pegar<TrabalhoDoBot>(url(0), ctl.signal)
      .then((trabalho) => setP({ estado: "pronto", trabalho, maisCarregando: false, maisErro: null }))
      .catch((e: Error) => e.name !== "AbortError" && setP((atual) => (atual.estado === "pronto" ? atual : { estado: "erro", erro: e.message })));
    return () => ctl.abort();
  }, [id, releitura]);

  const mais = useCallback(() => {
    if (p.estado !== "pronto" || p.trabalho.proximo === null || p.maisCarregando) return;
    const { trabalho } = p;
    setP({ ...p, maisCarregando: true, maisErro: null });
    pegar<TrabalhoDoBot>(url(trabalho.proximo!))
      .then((prox) =>
        setP({
          estado: "pronto",
          maisCarregando: false,
          maisErro: null,
          trabalho: juntar(trabalho, prox),
        }),
      )
      .catch((e: Error) => setP({ ...p, maisCarregando: false, maisErro: e.message }));
  }, [p, id]);

  return [p, mais] as const;
}

function LinhaConversa({ conversa: c }: { conversa: Conversa }) {
  return (
    <li>
      <a
        href={linkDaConversa(c.id)}
        onClick={aoClicarLink}
        className="flex min-w-0 items-center gap-3 rounded-[12px] px-3 py-2.5 transition-colors duration-150 hover:bg-hover"
      >
        <span className="min-w-0 flex-1 truncate font-medium">{c.titulo}</span>
        {c.arquivadaEm !== null && <span className="flex-none rounded-full bg-ativo px-2 py-0.5 text-xs text-tinta-2">Arquivada</span>}
        <span className="tabular flex-none text-xs text-tinta-3">{dataCurta.format(daColuna(c.atualizadaEm))}</span>
      </a>
    </li>
  );
}

function Historico({ id, releitura }: { id: BotId; releitura: string }) {
  const [p, mais] = useTrabalho(id, releitura);
  const nomes = useNomesDosBots();
  const nome = nomes[id].nome;
  if (p.estado === "carregando") return <Vazio>Carregando o histórico…</Vazio>;
  if (p.estado === "erro")
    return (
      <p role="alert" className="text-erro">
        Não deu para carregar o histórico. {p.erro}
      </p>
    );
  const { trabalho } = p;
  const vazio =
    trabalho.tipo === "conversas"
      ? "Nenhuma conversa ainda. Comece um pedido novo e ele aparece aqui."
      : `${nome} ainda não fez nenhuma tarefa. Quando ${nomes.chefe.nome} passar um pedido, ele fica registrado aqui.`;
  // As tarefas em andamento já aparecem em "Agora".
  const feitas = trabalho.tipo === "tarefas" ? trabalho.itens.filter((t) => !ativa(t.status)) : [];
  const nada = trabalho.tipo === "tarefas" ? feitas.length === 0 : trabalho.itens.length === 0;
  return (
    <>
      {nada ? (
        <Vazio>{vazio}</Vazio>
      ) : trabalho.tipo === "tarefas" ? (
        <ListaDeTarefas tarefas={feitas} />
      ) : (
        <ul className="-mx-3 flex flex-col">
          {trabalho.itens.map((c) => (
            <LinhaConversa key={c.id} conversa={c} />
          ))}
        </ul>
      )}
      {trabalho.proximo !== null && (
        <button
          type="button"
          onClick={mais}
          disabled={p.maisCarregando}
          className="pressiona self-start rounded-full bg-tinta/[0.06] px-4 py-2 font-medium transition-colors duration-150 hover:bg-tinta/10 disabled:cursor-progress disabled:text-tinta-3"
        >
          {p.maisCarregando ? "Carregando…" : "Mostrar mais"}
        </button>
      )}
      {p.maisErro && (
        <p role="alert" className="text-[13px] text-erro">
          Não deu para carregar mais. {p.maisErro}
        </p>
      )}
    </>
  );
}

/**
 * A aba Trabalho. `ativas` são as tarefas em andamento que a página já lê para o estado do cabeçalho:
 * as do bot, ou todas quando o bot é o Chefe, que coordena as delegações.
 */
export function Trabalho({ id, ativas }: { id: BotId; ativas: readonly ResumoTarefa[] | null }) {
  const nomes = useNomesDosBots();
  const nome = nomes[id].nome;
  const chefe = id === "chefe";
  const releitura = (ativas ?? []).map((t) => t.id).join(",");
  return (
    <div className="flex flex-col gap-8">
      <Secao titulo="Agora">
        {ativas === null ? (
          <Vazio>Carregando…</Vazio>
        ) : ativas.length === 0 ? (
          <Vazio>
            {chefe
              ? `Nenhum pedido em andamento. Quando ${nome} passar trabalho a um especialista, ele aparece aqui ao vivo.`
              : `${nome} está parado. Quando ${nomes.chefe.nome} passar um pedido, você acompanha cada passo por aqui.`}
          </Vazio>
        ) : (
          <ListaDeTarefas tarefas={ativas} mostrarBot={chefe} />
        )}
      </Secao>
      <Secao titulo={chefe ? "Conversas" : "Histórico"}>
        <Historico id={id} releitura={releitura} />
      </Secao>
    </div>
  );
}
