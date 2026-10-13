import { motion } from "motion/react";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { Agendamento, Agora, AprovacaoPendente, Historico, Publicacao, TarefaEmCurso, TarefaFeita } from "../../db";
import { useApi, useNomesDosBots, type Carga } from "../api";
import { Avatar } from "../componentes/Avatar";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { Capa } from "../componentes/Capa";
import { Falha } from "../componentes/Falha";
import { semMarkdown } from "../componentes/texto";
import { dataCurta, dataEHora, dia, hora, jaPassou, MIDIA } from "../componentes/peca";
import { Segmentado } from "../componentes/Segmentado";
import { aoClicarLink } from "../rota";
import { passosDe } from "../tipos";

type Aba = "agora" | "agendado" | "historico";

const ABAS = [
  { valor: "agora", rotulo: "Agora" },
  { valor: "agendado", rotulo: "Agendado" },
  { valor: "historico", rotulo: "Histórico" },
] as const;

export function Atividade({ abrirMenu }: { abrirMenu: () => void }) {
  const [aba, setAba] = useState<Aba>("agora");
  const painel = useId();
  useEffect(() => {
    document.title = "Atividade · EM Marketing";
  }, []);

  return (
    <main id="conteudo" className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 pt-3 pb-10 sm:px-6 md:pt-10">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <BotaoMenu abrir={abrirMenu} />
          <h1 className="mr-auto text-2xl/tight font-semibold tracking-[-0.02em]">Atividade</h1>
          <Segmentado tipo="abas" rotulo="Mostrar" opcoes={ABAS} valor={aba} aoMudar={setAba} idDoPainel={painel} />
        </header>
        <motion.div
          key={aba}
          id={painel}
          role="tabpanel"
          aria-label={ABAS.find((a) => a.valor === aba)!.rotulo}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          className="flex flex-col gap-8"
        >
          {aba === "agora" ? <PainelAgora /> : aba === "agendado" ? <PainelAgendado /> : <PainelHistorico />}
        </motion.div>
      </div>
    </main>
  );
}

/** Carregando, erro ou o conteúdo. Uma releitura que falha mantém os dados na tela (useApi). */
function Conteudo<T>({ carga, tentar, children }: { carga: Carga<T>; tentar: () => void; children: (dados: T) => ReactNode }) {
  if (carga.estado === "carregando") return <p className="text-tinta-3">Carregando…</p>;
  if (carga.estado === "erro") return <Falha texto="Não deu para carregar a atividade." erro={carga.erro} tentar={tentar} />;
  return children(carga.dados);
}

function Secao({ titulo, vazio, children }: { titulo: string; vazio: string; children: ReactNode[] }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-0.5">
      <h2 className="mb-2 text-xs font-normal text-tinta-3">{titulo}</h2>
      {children.length > 0 ? children : <p className="py-2 text-tinta-3">{vazio}</p>}
    </section>
  );
}

/** Agora, relido a cada segundo enquanto `ativo`, para os cronômetros das tarefas. */
function useRelogio(ativo: boolean) {
  const [agora, setAgora] = useState(Date.now);
  useEffect(() => {
    if (!ativo) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ativo]);
  return agora;
}

const decorrido = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

const linkDaConversa = (id: string) => `/c/${encodeURIComponent(id)}`;

function PainelAgora() {
  const [carga, tentar] = useApi<Agora>("/api/atividade/agora", 4000);
  const agora = useRelogio(carga.estado === "pronto" && carga.dados.trabalhando.length > 0);
  const { chefe } = useNomesDosBots();
  return (
    <Conteudo carga={carga} tentar={tentar}>
      {(d) => (
        <>
          <Secao titulo="Trabalhando" vazio={`Nenhum bot trabalhando agora. Peça algo para ${chefe.nome} e acompanhe por aqui.`}>
            {d.trabalhando.map((t) => (
              <LinhaTrabalhando key={t.id} tarefa={t} agora={agora} />
            ))}
          </Secao>
          <Secao titulo="Esperando você" vazio="Nada esperando a sua aprovação.">
            {d.esperando.map((a, i) => (
              <CartaoEsperando key={`${a.conversaId}-${i}`} aprovacao={a} />
            ))}
          </Secao>
          <Secao titulo="Concluídas hoje" vazio="Nenhuma tarefa terminou hoje.">
            {d.concluidas.map((t) => (
              <LinhaFeita key={t.id} tarefa={t} quando={hora.format(t.terminadaEm)} />
            ))}
          </Secao>
        </>
      )}
    </Conteudo>
  );
}

function LinhaTrabalhando({ tarefa: t, agora }: { tarefa: TarefaEmCurso; agora: number }) {
  const { nome } = useNomesDosBots()[t.botId];
  const passo =
    t.status === "na_fila" ? "Na fila" : (passosDe(t.ultima).findLast((p) => p.estado === "fazendo")?.rotulo ?? "Pensando");
  return (
    <a
      href={linkDaConversa(t.conversaId)}
      onClick={aoClicarLink}
      className="pressiona-leve grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] bg-hover p-3 hover:bg-ativo"
    >
      <Avatar bot={t.botId} tamanho={28} estado={t.status === "trabalhando" ? "trabalhando" : "parado"} anel="var(--color-hover)" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{t.pedido}</span>
        <span className="truncate text-[13px] text-tinta-3">
          {nome} · {passo}
        </span>
      </span>
      <span className="font-mono text-xs text-trabalhando-texto tabular">
        {decorrido(agora - t.criadaEm)}
      </span>
    </a>
  );
}

function CartaoEsperando({ aprovacao: a }: { aprovacao: AprovacaoPendente }) {
  const { chefe } = useNomesDosBots();
  const peca = a.headline ? `"${a.headline}"` : "a peça";
  const onde = a.tipo ? ` no ${MIDIA[a.tipo].toLowerCase()}` : "";
  const titulo = `${a.acao === "publicar_agora" ? "Publicar agora" : "Agendar"} ${peca}${onde}`;
  const quando = a.acao === "agendar_publicacao" && a.publicarEm ? new Date(a.publicarEm) : null;
  const detalhes = [chefe.nome, quando ? dataEHora.format(quando) : null, a.pilar ? `pilar ${a.pilar}` : null].filter(Boolean);
  return (
    <a
      href={linkDaConversa(a.conversaId)}
      onClick={aoClicarLink}
      className="pressiona-leve flex flex-wrap items-center gap-3.5 rounded-[18px] border border-linha-forte bg-superficie px-4 py-3.5 hover:bg-fundo"
    >
      <Capa url={a.capa} headline={null} className="w-[52px] rounded-lg" />
      <span className="flex min-w-0 flex-[1_1_240px] flex-col">
        <span className="font-medium text-pretty [overflow-wrap:anywhere]">{titulo}</span>
        <span className="text-[13px] text-tinta-3">{detalhes.join(" · ")}</span>
        {quando && jaPassou(quando) && <span className="text-[13px] text-esperando-texto">Horário já passou. Escolha outro na conversa.</span>}
      </span>
      <span className="rounded-full bg-tinta px-4 py-2 font-medium text-sobre-tinta">Revisar na conversa</span>
    </a>
  );
}

function LinhaFeita({ tarefa: t, quando }: { tarefa: TarefaFeita; quando: string }) {
  const { nome } = useNomesDosBots()[t.botId];
  const texto = t.status === "falhou" ? `falhou. ${semMarkdown(t.erro ?? t.pedido)}` : semMarkdown(t.resumo ?? "") || "Concluída";
  return (
    <a
      href={linkDaConversa(t.conversaId)}
      onClick={aoClicarLink}
      className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-3 py-2.5 text-tinta-2 realce hover:bg-hover"
    >
      <Avatar bot={t.botId} tamanho={28} />
      <span className="truncate">
        <span className={t.status === "falhou" ? "text-erro" : undefined}>
          {nome}: {texto}
        </span>
      </span>
      <span className="font-mono text-xs text-tinta-3 tabular">{quando}</span>
    </a>
  );
}

const ESTADO_FILA: Record<Agendamento["status"], { rotulo: string; cor: string }> = {
  pending: { rotulo: "Agendado", cor: "text-esperando-texto" },
  publishing: { rotulo: "Publicando", cor: "text-tinta" },
  failed: { rotulo: "Falhou", cor: "text-erro" },
};

function PainelAgendado() {
  const [carga, tentar] = useApi<Agendamento[]>("/api/atividade/agendado", 30000);
  const { chefe } = useNomesDosBots();
  return (
    <Conteudo carga={carga} tentar={tentar}>
      {(itens) => (
        <Secao titulo="Na fila de publicação" vazio={`Nada agendado. Quando ${chefe.nome} agendar uma peça, ela aparece aqui com dia e hora.`}>
          {itens.map((a) => (
            <LinhaDePeca
              key={a.id}
              capa={a.capa}
              headline={a.headline}
              detalhe={[a.pilar, MIDIA[a.tipo]].filter(Boolean).join(" · ")}
              quando={dataCurta.format(new Date(a.publicarEm))}
              estado={a.status === "pending" && jaPassou(new Date(a.publicarEm)) ? { rotulo: "Horário já passou", cor: "text-esperando-texto" } : ESTADO_FILA[a.status]}
              motivo={a.status === "failed" ? (a.erro ?? "O Instagram não disse o motivo.") : undefined}
            />
          ))}
        </Secao>
      )}
    </Conteudo>
  );
}

function LinhaDePeca({
  capa,
  headline,
  detalhe,
  quando,
  estado,
  motivo,
  href,
}: {
  capa: string | null;
  headline: string | null;
  detalhe: string;
  quando: string;
  estado?: { rotulo: string; cor: string };
  /** Por que a publicação falhou, numa linha própria embaixo da peça. */
  motivo?: string;
  href?: string;
}) {
  const corpo = (
    <>
      <Capa url={capa} headline={null} className="w-10 rounded-md" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{headline ?? "Peça sem headline"}</span>
        <span className="truncate text-[13px] text-tinta-3">{detalhe}</span>
      </span>
      <span className="flex flex-col items-end text-right">
        <span className="text-xs text-tinta-2 tabular">{quando}</span>
        {estado && <span className={`text-xs ${estado.cor}`}>{estado.rotulo}</span>}
        {href && <span className="text-xs text-tinta-2 underline decoration-linha-forte underline-offset-2">Abrir no Instagram</span>}
      </span>
      {motivo && <span className="col-start-2 col-end-4 text-[13px] text-pretty text-erro [overflow-wrap:anywhere]">Não publicou. {motivo}</span>}
    </>
  );
  const classe = "grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-3 py-2.5";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" className={`${classe} realce hover:bg-hover`}>
      {corpo}
    </a>
  ) : (
    <div className={classe}>
      {corpo}
    </div>
  );
}

function PainelHistorico() {
  const [carga, tentar] = useApi<Historico>("/api/atividade/historico", 60000);
  return (
    <Conteudo carga={carga} tentar={tentar}>
      {(d) => (
        <>
          <Secao titulo="Publicadas no Instagram" vazio="Nenhuma peça publicada ainda.">
            {d.publicacoes.map((p) => (
              <LinhaPublicada key={p.id} publicacao={p} />
            ))}
          </Secao>
          <Secao titulo="Tarefas de antes de hoje" vazio="Nenhuma tarefa anterior a hoje.">
            {d.tarefas.map((t) => (
              <LinhaFeita key={t.id} tarefa={t} quando={dia.format(t.terminadaEm)} />
            ))}
          </Secao>
        </>
      )}
    </Conteudo>
  );
}

function LinhaPublicada({ publicacao: p }: { publicacao: Publicacao }) {
  return (
    <LinhaDePeca
      capa={p.capa}
      headline={p.headline}
      detalhe={[p.pilar, MIDIA[p.tipo]].filter(Boolean).join(" · ")}
      quando={dataCurta.format(new Date(p.publicadaEm))}
      href={p.permalink ?? undefined}
    />
  );
}
