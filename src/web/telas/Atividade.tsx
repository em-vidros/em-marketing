import { motion } from "motion/react";
import { useEffect, useId, useState, type ReactNode } from "react";
import type { Agendamento, Agora, AprovacaoPendente, Historico, Publicacao, TarefaEmCurso, TarefaFeita } from "../../db";
import { useApi, useNomesDosBots, type Carga } from "../api";
import { Avatar } from "../componentes/Avatar";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { Capa } from "../componentes/Capa";
import { dataCurta, dataEHora, dia, hora, MIDIA } from "../componentes/peca";
import { Segmentado } from "../componentes/Segmentado";
import { MOLA_REDUZIDA } from "../movimento";
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
          transition={MOLA_REDUZIDA}
          className="flex flex-col gap-8"
        >
          {aba === "agora" ? <PainelAgora /> : aba === "agendado" ? <PainelAgendado /> : <PainelHistorico />}
        </motion.div>
      </div>
    </main>
  );
}

/** Carregando, erro ou o conteúdo. Uma releitura que falha mantém os dados na tela (useApi). */
function Conteudo<T>({ carga, children }: { carga: Carga<T>; children: (dados: T) => ReactNode }) {
  if (carga.estado === "carregando") return <p className="text-tinta-3">Carregando…</p>;
  if (carga.estado === "erro")
    return (
      <p role="alert" className="text-erro">
        Não deu para carregar. {carga.erro.message}
      </p>
    );
  return children(carga.dados);
}

function Secao({ titulo, vazio, children }: { titulo: string; vazio: string; children: ReactNode[] }) {
  return (
    <section aria-label={titulo} className="flex flex-col gap-0.5">
      <h2 className="mb-2 text-xs font-normal text-tinta-4">{titulo}</h2>
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
  const [carga] = useApi<Agora>("/api/atividade/agora", 4000);
  const agora = useRelogio(carga.estado === "pronto" && carga.dados.trabalhando.length > 0);
  const { chefe } = useNomesDosBots();
  return (
    <Conteudo carga={carga}>
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
      className="pressiona grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] bg-hover p-3 transition-colors duration-150 hover:bg-ativo"
    >
      <Avatar bot={t.botId} tamanho={28} estado={t.status === "trabalhando" ? "trabalhando" : "parado"} anel="var(--color-hover)" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{t.pedido}</span>
        <span className="truncate text-[13px] text-tinta-3">
          {nome} · {passo}
        </span>
      </span>
      <span className="font-mono text-xs text-[#2f646a] tabular">
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
  const detalhes = [
    chefe.nome,
    a.acao === "agendar_publicacao" && a.publicarEm ? dataEHora.format(new Date(a.publicarEm)) : null,
    a.pilar ? `pilar ${a.pilar}` : null,
  ].filter(Boolean);
  return (
    <a
      href={linkDaConversa(a.conversaId)}
      onClick={aoClicarLink}
      className="pressiona flex flex-wrap items-center gap-3.5 rounded-[18px] border border-linha-forte bg-superficie px-4 py-3.5 transition-colors duration-150 hover:bg-fundo"
    >
      <Capa url={a.capa} headline={null} className="w-[52px] rounded-lg" />
      <span className="flex min-w-0 flex-[1_1_240px] flex-col">
        <span className="font-medium text-pretty">{titulo}</span>
        <span className="text-[13px] text-tinta-3">{detalhes.join(" · ")}</span>
      </span>
      <span className="rounded-full bg-tinta px-4 py-2 font-medium text-sobre-tinta">Revisar na conversa</span>
    </a>
  );
}

function LinhaFeita({ tarefa: t, quando }: { tarefa: TarefaFeita; quando: string }) {
  const { nome } = useNomesDosBots()[t.botId];
  const texto = t.status === "falhou" ? `falhou. ${t.erro ?? t.pedido}` : (t.resumo ?? t.pedido);
  return (
    <a
      href={linkDaConversa(t.conversaId)}
      onClick={aoClicarLink}
      className="grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-3 py-2.5 text-tinta-2 transition-colors duration-150 hover:bg-hover"
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
  pending: { rotulo: "Agendado", cor: "text-[hsl(45_100%_29%)]" },
  publishing: { rotulo: "Publicando", cor: "text-tinta" },
  failed: { rotulo: "Falhou", cor: "text-erro" },
};

function PainelAgendado() {
  const [carga] = useApi<Agendamento[]>("/api/atividade/agendado", 30000);
  const { chefe } = useNomesDosBots();
  return (
    <Conteudo carga={carga}>
      {(itens) => (
        <Secao titulo="Na fila de publicação" vazio={`Nada agendado. Quando ${chefe.nome} agendar uma peça, ela aparece aqui com dia e hora.`}>
          {itens.map((a) => (
            <LinhaDePeca
              key={a.id}
              capa={a.capa}
              headline={a.headline}
              detalhe={[a.pilar, MIDIA[a.tipo]].filter(Boolean).join(" · ")}
              quando={dataCurta.format(new Date(a.publicarEm))}
              estado={ESTADO_FILA[a.status]}
              titulo={a.status === "failed" && a.erro ? a.erro : undefined}
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
  titulo,
  href,
}: {
  capa: string | null;
  headline: string | null;
  detalhe: string;
  quando: string;
  estado?: { rotulo: string; cor: string };
  titulo?: string;
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
      </span>
    </>
  );
  const classe = "grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 rounded-[14px] px-3 py-2.5";
  return href ? (
    <a href={href} target="_blank" rel="noreferrer" title={titulo} className={`${classe} transition-colors duration-150 hover:bg-hover`}>
      {corpo}
    </a>
  ) : (
    <div title={titulo} className={classe}>
      {corpo}
    </div>
  );
}

function PainelHistorico() {
  const [carga] = useApi<Historico>("/api/atividade/historico", 60000);
  return (
    <Conteudo carga={carga}>
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
      detalhe={[p.pilar, MIDIA[p.tipo], p.permalink ? "Abrir no Instagram" : null].filter(Boolean).join(" · ")}
      quando={dataCurta.format(new Date(p.publicadaEm))}
      href={p.permalink ?? undefined}
    />
  );
}
