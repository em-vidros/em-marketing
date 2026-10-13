import { motion } from "motion/react";
import { useEffect, useId, useReducer } from "react";
import type { Agora } from "../../db";
import type { Modelo } from "../../agent/models";
import { type NomesDosBots, useApi, useNomesDosBots } from "../api";
import { BOT_IDS } from "../bots";
import { Avatar } from "../componentes/Avatar";
import { Teclas } from "../componentes/menu/Teclas";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { Falha } from "../componentes/Falha";
import { Configuracao, useFormularioDoBot } from "../componentes/bot/Configuracao";
import { formulario, sujo, type DetalheBot } from "../componentes/bot/formulario";
import { Trabalho } from "../componentes/bot/Trabalho";
import { Segmentado } from "../componentes/Segmentado";
import type { EstadoBot } from "../equipe";
import { aoClicarLink, navegar } from "../rota";
import { ariaDe, atalhoDeConversa, ehMac } from "../teclado/atalhos";
import type { BotId, ResumoTarefa } from "../tipos";

type Aba = "trabalho" | "config";

const ABAS = [
  { valor: "trabalho", rotulo: "Trabalho" },
  { valor: "config", rotulo: "Configuração" },
] as const;

const caminhoDa = (id: BotId, aba: Aba) => (aba === "config" ? `/bots/${id}/config` : `/bots/${id}`);

/** O estado do cabeçalho, das tarefas ativas. O Chefe espera você quando há aprovação pendente. */
function estadoDo(id: BotId, ativas: readonly ResumoTarefa[], aprovacoes: number, nomes: NomesDosBots): EstadoBot {
  if (id === "chefe") {
    if (aprovacoes > 0) return { tipo: "esperando", texto: "Esperando você" };
    const ocupado = ativas.find((t) => t.status === "trabalhando") ?? ativas[0];
    return ocupado ? { tipo: "delegando", texto: `Esperando ${nomes[ocupado.botId].nome}` } : { tipo: "parado", texto: "Parado" };
  }
  if (ativas.some((t) => t.status === "trabalhando")) return { tipo: "trabalhando", texto: "Trabalhando" };
  return { tipo: "parado", texto: ativas.length > 0 ? "Na fila" : "Parado" };
}

const COR_DO_PONTO: Record<EstadoBot["tipo"], string> = {
  parado: "bg-tinta-4",
  trabalhando: "bg-trabalhando",
  esperando: "bg-esperando",
  delegando: "bg-trabalhando",
};

export default function Bot(props: { id: BotId; aba: Aba; abrirMenu: () => void; conversar: () => void }) {
  return <PaginaDoBot key={props.id} {...props} />;
}

function PaginaDoBot({ id, aba, abrirMenu, conversar }: { id: BotId; aba: Aba; abrirMenu: () => void; conversar: () => void }) {
  const [f, despachar] = useReducer(formulario, { fase: "carregando" });
  const [config, relerConfig] = useApi<DetalheBot>(`/api/bots/${id}/config`);
  const [modelos, relerModelos] = useApi<Modelo[]>("/api/modelos");
  const nomes = useNomesDosBots();
  const [atividade] = useApi<ResumoTarefa[]>("/api/atividade", 3000);
  const [agora] = useApi<Agora>(id === "chefe" ? "/api/atividade/agora" : null, 5000);
  const painel = useId();
  useFormularioDoBot(id, despachar);

  useEffect(() => {
    if (config.estado === "pronto") despachar({ tipo: "chegou", detalhe: config.dados });
  }, [config]);

  const salvo = f.fase === "pronto" ? f.salvo : null;
  const nome = salvo?.nome ?? nomes[id].nome;
  const descricao = salvo?.descricao ?? nomes[id].descricao;
  const ativas =
    atividade.estado === "pronto" ? atividade.dados.filter((t) => id === "chefe" || t.botId === id) : atividade.estado === "erro" ? [] : null;
  const estado = estadoDo(id, ativas ?? [], agora.estado === "pronto" ? agora.dados.esperando.length : 0, nomes);
  const emUso = salvo && modelos.estado === "pronto" ? modelos.dados.find((m) => m.id === salvo.modelo) : undefined;
  const modelo = salvo && modelos.estado === "pronto" ? (emUso?.nome ?? salvo.modelo) : null;
  const semChave = !!emUso && !emUso.disponivel;

  useEffect(() => {
    document.title = `${nome}${aba === "config" ? " · Configuração" : ""} · EM Marketing`;
  }, [nome, aba]);

  /** Trocar de bot com alterações pendentes perderia o rascunho: a barra pede para salvar ou descartar antes. */
  const segurarSeSujo = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!sujo(f)) return aoClicarLink(e);
    e.preventDefault();
    despachar({ tipo: "falhou", erro: "Salve ou descarte as alterações antes de trocar de bot." });
  };

  return (
    <main id="conteudo" className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-7 px-4 pt-3 sm:px-6 md:pt-10">
        <BotaoMenu abrir={abrirMenu} />
        <header className="flex flex-wrap items-start gap-4 sm:flex-nowrap sm:items-center">
          <Avatar bot={id} tamanho={56} estado={estado.tipo} anel="var(--color-fundo)" />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl/tight font-semibold tracking-[-0.02em] text-balance [overflow-wrap:anywhere]">{nome}</h1>
            <p className="text-pretty text-tinta-2 [overflow-wrap:anywhere]">{descricao}</p>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-tinta-3">
              <span role="status" className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`size-1.5 rounded-full ${COR_DO_PONTO[estado.tipo]}`} />
                {estado.texto}
              </span>
              {modelo && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{modelo}</span>
                </>
              )}
              {semChave && (
                <span className="rounded-full bg-esperando/15 px-2 py-0.5 text-xs text-esperando-texto">Sem chave de API. Ele não responde até trocar o modelo.</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={conversar}
            aria-keyshortcuts={ariaDe(atalhoDeConversa(id), ehMac) || undefined}
            className="pressiona flex h-10 flex-none cursor-pointer items-center gap-2 rounded-full bg-tinta px-4 font-medium text-sobre-tinta max-sm:w-full max-sm:justify-center sm:ml-auto"
          >
            Nova conversa com {nome}
            <span className="max-md:hidden">
              <Teclas atalho={atalhoDeConversa(id)} tom="escuro" />
            </span>
          </button>
        </header>

        <div className="flex">
        <Segmentado
          tipo="abas"
          rotulo={`Seções do ${nome}`}
          opcoes={ABAS}
          valor={aba}
          aoMudar={(a) => navegar(caminhoDa(id, a))}
          idDoPainel={painel}
        />
        </div>

        <motion.div
          key={aba}
          id={painel}
          role="tabpanel"
          aria-label={ABAS.find((a) => a.valor === aba)!.rotulo}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
          className={aba === "config" ? "grid gap-8 lg:grid-cols-[176px_minmax(0,1fr)]" : "pb-12"}
        >
          {aba === "trabalho" ? (
            <Trabalho id={id} ativas={ativas} />
          ) : (
            <>
              <nav aria-label="Configurar outro bot" className="hidden lg:block">
                <ul className="sticky top-6 flex flex-col gap-0.5">
                  {BOT_IDS.map((b) => {
                    const atual = b === id;
                    const rotulo = b === id ? nome : nomes[b].nome;
                    return (
                      <li key={b}>
                        <a
                          href={caminhoDa(b, "config")}
                          onClick={segurarSeSujo}
                          aria-current={atual ? "page" : undefined}
                          className={`flex min-h-9 items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-[13px] transition-colors duration-150 ${
                            atual ? "bg-ativo font-medium text-tinta" : "text-tinta-2 hover:bg-hover hover:text-tinta"
                          }`}
                        >
                          <Avatar bot={b} tamanho={18} />
                          <span className="truncate">{rotulo}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              <div className="min-w-0">
                {f.fase === "pronto" ? (
                  <Configuracao id={id} f={f} despachar={despachar} modelos={modelos} relerModelos={relerModelos} />
                ) : config.estado === "erro" ? (
                  <Falha texto="Não deu para abrir a configuração." erro={config.erro} tentar={relerConfig} />
                ) : (
                  <p className="text-tinta-3">Carregando a configuração…</p>
                )}
              </div>
            </>
          )}
        </motion.div>
      </div>
    </main>
  );
}
