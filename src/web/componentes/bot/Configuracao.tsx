import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef, useState, type Dispatch } from "react";
import { flushSync } from "react-dom";
import type { Modelo } from "../../../agent/models";
import { useApi, type Carga } from "../../api";
import { recarregarBots, useEquipe, type BotId } from "../../bots";
import { MOLA, MOLA_REDUZIDA } from "../../movimento";
import { navegar } from "../../rota";
import { ehCampo } from "../../teclado/motor";
import { Falha } from "../Falha";
import { fecharAviso, mostrarAviso } from "../menu/Avisos";
import { pilhaDeDesfazer } from "../menu/desfazer";
import { dataCurta } from "../peca";
import { Cartao, Confirmar, Descricao, estiloCampo, Ferramentas, Linha, Problema, SeletorDeModelo, Setor, TextoLongo } from "./campos";
import { enviar } from "./enviar";
import {
  CAMPOS,
  LIMITE,
  mudanca,
  oQueMudou,
  problemasDe,
  sujo,
  type Acao,
  type CampoEditavel,
  type DetalheBot,
  type Edicao,
  type Editavel,
  type Formulario,
  type VersaoBot,
} from "./formulario";
import { Memoria, PromptFinal } from "./Memoria";

type Pronto = Extract<Formulario, { fase: "pronto" }>;

/**
 * O formulário de cada página de bot montada. O desfazer de uma restauração roda no servidor e
 * pode chegar depois de trocar de aba; por aqui ele acha o formulário que estiver na tela.
 */
const formularios = new Map<BotId, Dispatch<Acao>>();

/**
 * As entradas da pilha de desfazer que reescrevem o formulário. Editar o rascunho as invalida,
 * porque desfazer jogaria a edição fora; sair da página invalida o descarte, cujo rascunho some.
 */
const doFormulario = new Map<BotId, { descarte?: number; restauro?: number }>();

function largar(id: BotId, qual: "descarte" | "restauro") {
  const chave = doFormulario.get(id)?.[qual];
  if (chave === undefined) return;
  pilhaDeDesfazer.descartar(chave);
  fecharAviso(chave);
  delete doFormulario.get(id)![qual];
}

function empilhar(id: BotId, qual: "descarte" | "restauro", desfazer: () => void | Promise<void>, texto: string) {
  largar(id, qual);
  const chave = pilhaDeDesfazer.empilhar(desfazer);
  doFormulario.set(id, { ...doFormulario.get(id), [qual]: chave });
  mostrarAviso({ tipo: "desfazivel", chave, texto });
}

/** Liga o formulário da página ao desfazer. Chame na página do bot, que é dona do reducer. */
export function useFormularioDoBot(id: BotId, despachar: Dispatch<Acao>) {
  useEffect(() => {
    formularios.set(id, despachar);
    return () => {
      formularios.delete(id);
      largar(id, "descarte");
    };
  }, [id, despachar]);
}


const autorCurto = (email: string) => email.split("@")[0] ?? email;

function Versoes({
  id,
  f,
  modelos,
  restaurar,
}: {
  id: BotId;
  f: Pronto;
  modelos: Carga<Modelo[]>;
  restaurar: (caminho: string, texto: string) => Promise<void>;
}) {
  const [carga, recarregar] = useApi<VersaoBot[]>(`/api/bots/${id}/versoes`);
  useEffect(recarregar, [f.salvo.versaoId, recarregar]);
  const [confirmando, setConfirmando] = useState<number | "padrao" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const nomes = useEquipe();
  const criado = f.salvo.criado !== null;
  const padraoEh = criado ? "a primeira versão" : "o texto original do código";
  const abridores = useRef(new Map<number | "padrao", HTMLButtonElement | null>());
  /** Cancelar devolve o foco ao botão que abriu a confirmação, que volta a existir ao fechar. */
  const cancelar = () => {
    const alvo = confirmando;
    flushSync(() => setConfirmando(null));
    if (alvo !== null) abridores.current.get(alvo)?.focus();
  };
  const temRascunho = sujo(f);
  const nomeDo = (m: string) => (modelos.estado === "pronto" ? (modelos.dados.find((x) => x.id === m)?.nome ?? m) : m);
  const noPadrao = CAMPOS.every((c) => f.salvo.padrao[c]);
  const voltarAoPadrao = criado ? "Voltar à primeira versão?" : "Voltar ao texto original do código?";

  const fazer = async (caminho: string, texto: string) => {
    setConfirmando(null);
    setErro(null);
    await restaurar(caminho, texto).catch((e: Error) => setErro(e.message));
  };
  const pedir = (alvo: number | "padrao", caminho: string, texto: string) =>
    alvo === "padrao" || temRascunho ? setConfirmando(alvo) : void fazer(caminho, texto);

  const padrao = `/api/bots/${id}/padrao`;

  return (
    <Cartao titulo="Histórico de versões">
      <div className="flex flex-col gap-3 px-5 py-4">
        {confirmando === "padrao" ? (
          <Confirmar
            pergunta={
              temRascunho
                ? `${voltarAoPadrao} O que você editou e não salvou se perde; a versão atual fica no histórico.`
                : `${voltarAoPadrao} A versão atual fica no histórico.`
            }
            rotulo="Restaurar padrão"
            confirmar={() => fazer(padrao, criado ? "Primeira versão restaurada." : "Padrão do código restaurado.")}
            cancelar={cancelar}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-[13px] text-pretty text-tinta-3">
              {noPadrao ? `Em uso: ${padraoEh}.` : "Cada gravação vira uma versão. Restaurar grava uma versão nova, então nada se perde."}
            </p>
            <button
              ref={(el) => void abridores.current.set("padrao", el)}
              type="button"
              onClick={() => pedir("padrao", padrao, "")}
              disabled={noPadrao && !temRascunho}
              className="pressiona rounded-full bg-tinta/[0.06] px-3.5 py-1.5 font-medium hover:bg-tinta/10 disabled:cursor-not-allowed disabled:text-tinta-4 disabled:hover:bg-tinta/[0.06]"
            >
              Restaurar padrão
            </button>
          </div>
        )}
        {erro && (
          <p role="alert" className="text-[13px] text-erro">
            Não deu para restaurar. {erro}
          </p>
        )}
      </div>
      {carga.estado === "carregando" ? (
        <p className="border-t border-linha px-5 py-4 text-tinta-3">Carregando as versões…</p>
      ) : carga.estado === "erro" ? (
        <Falha texto="Não deu para carregar as versões." erro={carga.erro} tentar={recarregar} className="border-t border-linha px-5 py-4" />
      ) : carga.dados.length === 0 ? (
        <p className="border-t border-linha px-5 py-4 text-pretty text-tinta-3">
          Nenhuma versão gravada. {nomes.de(id).nome} usa o texto original do código até alguém salvar uma mudança.
        </p>
      ) : (
        <ol className="flex flex-col">
          {carga.dados.map((v, i) => {
            const emUso = v.id === f.salvo.versaoId;
            const caminho = `/api/bots/${id}/versoes/${v.id}/restaurar`;
            const texto = `Versão de ${dataCurta.format(v.criadaEm)} restaurada.`;
            return (
              <li key={v.id} className="flex flex-col gap-2 border-t border-linha px-5 py-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="flex min-w-0 flex-[1_1_260px] flex-col">
                    <span className="font-medium">
                      {oQueMudou(v, carga.dados[i + 1])}
                      {emUso && <span className="ml-2 rounded-full bg-ativo px-2 py-0.5 align-[1px] text-xs font-normal text-tinta-2">Em uso</span>}
                    </span>
                    <span className="tabular truncate text-xs text-tinta-3">
                      <span title={v.autor}>{autorCurto(v.autor)}</span> · {dataCurta.format(v.criadaEm)} · {nomeDo(v.modelo)}
                    </span>
                  </div>
                  {!emUso && confirmando !== v.id && (
                    <button
                      ref={(el) => void abridores.current.set(v.id, el)}
                      type="button"
                      onClick={() => pedir(v.id, caminho, texto)}
                      aria-label={`Restaurar a versão de ${dataCurta.format(v.criadaEm)}`}
                      className="pressiona rounded-full px-3 py-1.5 font-medium text-tinta-2 hover:bg-hover hover:text-tinta"
                    >
                      Restaurar
                    </button>
                  )}
                </div>
                {confirmando === v.id && (
                  <Confirmar
                    pergunta="Restaurar esta versão? O que você editou e não salvou se perde."
                    rotulo="Restaurar"
                    confirmar={() => fazer(caminho, texto)}
                    cancelar={cancelar}
                  />
                )}
                <details className="group">
                  <summary className="w-fit cursor-pointer list-none text-xs text-tinta-3 hover:text-tinta [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Ver o texto</span>
                    <span className="hidden group-open:inline">Esconder o texto</span>
                  </summary>
                  <div className="mt-2 flex flex-col gap-1 rounded-[10px] bg-fundo px-3 py-2.5 text-[13px] [overflow-wrap:anywhere]">
                    <p>
                      <span className="text-tinta-3">Nome:</span> {v.nome}
                    </p>
                    <p className="text-pretty">
                      <span className="text-tinta-3">Descrição:</span> {v.descricao}
                    </p>
                    <p>
                      <span className="text-tinta-3">Setor:</span> {v.setor}
                    </p>
                    <pre className="mt-1 max-h-60 overflow-auto overscroll-contain font-mono text-xs/relaxed whitespace-pre-wrap text-tinta-2">{v.prompt}</pre>
                    {v.regras && (
                      <pre className="mt-1 max-h-60 overflow-auto overscroll-contain border-t border-linha pt-2 font-mono text-xs/relaxed whitespace-pre-wrap text-tinta-2">
                        {v.regras}
                      </pre>
                    )}
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </Cartao>
  );
}

/** A barra que aparece com alterações não salvas. O desfazer de descartar e restaurar vai pelo toast do app. */
function Barra({ f, salvar, descartar }: { f: Pronto; salvar: () => void; descartar: () => void }) {
  const reduzir = useReducedMotion();
  const mostrar = sujo(f);
  const fora = reduzir ? { opacity: 0 } : { opacity: 0, transform: "translateY(12px) scale(0.98)" };
  return (
    <div className="pointer-events-none sticky bottom-0 z-10 flex justify-center pt-6 pb-[max(16px,env(safe-area-inset-bottom))]">
      <div role="status" className="sr-only">
        {mostrar ? (f.erro ?? "") : ""}
      </div>
      <AnimatePresence initial={false}>
        {mostrar && (
          <motion.div
            initial={fora}
            animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
            exit={fora}
            transition={reduzir ? MOLA_REDUZIDA : MOLA}
            className="pointer-events-auto flex w-full max-w-xl items-center gap-2 rounded-[20px] bg-tinta py-2 pr-2 pl-4 text-sobre-tinta shadow-[0_8px_30px_rgb(15_13_10/0.18)]"
          >
            <p className={`mr-auto line-clamp-2 min-w-0 flex-1 text-[13px] ${f.erro ? "text-erro-sobre-tinta" : "text-sobre-tinta/80"}`}>
              {f.erro ?? "Alterações não salvas"}
            </p>
            <button
              type="button"
              onClick={descartar}
              aria-keyshortcuts="Escape"
              className="pressiona flex flex-none items-center gap-1.5 rounded-full px-3 py-1.5 font-medium text-sobre-tinta/80 hover:bg-white/10 hover:text-sobre-tinta"
            >
              Descartar <kbd className="hidden font-sans text-xs text-sobre-tinta/50 sm:inline">Esc</kbd>
            </button>
            <button
              type="button"
              onClick={salvar}
              disabled={f.enviando}
              aria-keyshortcuts="Meta+S"
              className="pressiona flex flex-none items-center gap-1.5 rounded-full bg-sobre-tinta px-3.5 py-1.5 font-medium text-tinta disabled:cursor-progress disabled:opacity-70"
            >
              {f.enviando ? "Salvando…" : "Salvar"} <kbd className="hidden font-sans text-xs text-tinta-3 sm:inline">⌘S</kbd>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Apagar some com o bot da barra; as conversas dele continuam abertas para leitura. O desfazer do toast traz de volta. */
function Apagar({ id, nome }: { id: BotId; nome: string }) {
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const apagar = async () => {
    setConfirmando(false);
    setErro(null);
    try {
      await enviar<undefined>(`/api/bots/${id}`, "DELETE");
    } catch (e) {
      return setErro((e as Error).message);
    }
    void recarregarBots();
    navegar("/");
    const chave = pilhaDeDesfazer.empilhar(() =>
      enviar<DetalheBot>(`/api/bots/${id}/restaurar`, "POST")
        .then(() => recarregarBots())
        .catch((e: Error) => mostrarAviso({ tipo: "erro", texto: `Não deu para desfazer. ${e.message}` })),
    );
    mostrarAviso({ tipo: "desfazivel", chave, texto: `${nome} apagado.` });
  };
  return (
    <Cartao titulo="Apagar">
      <div className="flex flex-col gap-3 px-5 py-4">
        {confirmando ? (
          <Confirmar
            pergunta={`Apagar ${nome}? Ele sai da barra para todo mundo. As conversas com ele continuam abertas para leitura.`}
            rotulo="Apagar bot"
            confirmar={() => void apagar()}
            cancelar={() => setConfirmando(false)}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="mr-auto text-[13px] text-pretty text-tinta-3">Tira o bot da equipe. Dá para desfazer logo depois.</p>
            <button type="button" onClick={() => setConfirmando(true)} className="pressiona rounded-full px-3.5 py-1.5 font-medium text-erro hover:bg-erro/10">
              Apagar bot
            </button>
          </div>
        )}
        {erro && (
          <p role="alert" className="text-[13px] text-erro">
            Não deu para apagar. {erro}
          </p>
        )}
      </div>
    </Cartao>
  );
}

/**
 * A aba Configuração. O estado do formulário mora na página (Bot.tsx), que mostra o nome salvo no
 * cabeçalho; aqui ficam os campos, a memória, o prompt final, o histórico e os atalhos ⌘S e Esc.
 */
export function Configuracao({
  id,
  f,
  despachar,
  modelos,
  relerModelos,
}: {
  id: BotId;
  f: Pronto;
  despachar: Dispatch<Acao>;
  modelos: Carga<Modelo[]>;
  relerModelos: () => void;
}) {
  const ids = useId();
  const campos = useRef<Partial<Record<CampoEditavel, HTMLElement | null>>>({});
  const equipe = useEquipe();
  const setores = [...new Set(equipe.lista.map((b) => b.setor))];
  const [memoriaEm, setMemoriaEm] = useState(f.salvo.memoria.atualizadaEm);
  const criado = f.salvo.criado !== null;

  const editar = (edicao: Edicao) => {
    largar(id, "descarte");
    largar(id, "restauro");
    despachar(edicao);
  };

  const salvar = async () => {
    if (!sujo(f) || f.enviando) return;
    const problemas = problemasDe(f.rascunho);
    despachar({ tipo: "enviar", problemas });
    const primeiro = CAMPOS.find((c) => problemas[c]);
    if (primeiro) return campos.current[primeiro]?.focus();
    try {
      const detalhe = await enviar<DetalheBot>(`/api/bots/${id}/config`, "PUT", mudanca(f.salvo, f.rascunho));
      despachar({ tipo: "chegou", detalhe });
      if (detalhe.versaoId !== f.salvo.versaoId) void recarregarBots();
    } catch (e) {
      despachar({ tipo: "falhou", erro: `Não salvou. ${(e as Error).message}` });
    }
  };

  const descartar = () => {
    if (!sujo(f)) return;
    despachar({ tipo: "descartar" });
    empilhar(id, "descarte", () => formularios.get(id)?.({ tipo: "recuperar" }), "Alterações descartadas.");
  };

  /** Restaura e oferece voltar à versão que estava em uso, que continua no histórico. */
  const restaurar = async (caminho: string, texto: string) => {
    const anterior = f.salvo.versaoId;
    despachar({ tipo: "chegou", detalhe: await enviar<DetalheBot>(caminho, "POST") });
    void recarregarBots();
    const volta = anterior === null ? `/api/bots/${id}/padrao` : `/api/bots/${id}/versoes/${anterior}/restaurar`;
    empilhar(
      id,
      "restauro",
      () =>
        enviar<DetalheBot>(volta, "POST")
          .then((detalhe) => {
            formularios.get(id)?.({ tipo: "chegou", detalhe });
            void recarregarBots();
          })
          .catch((e: Error) => mostrarAviso({ tipo: "erro", texto: `Não deu para desfazer. ${e.message}` })),
      texto,
    );
  };

  const atalhos = useRef({ salvar, descartar });
  atalhos.current = { salvar, descartar };
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void atalhos.current.salvar();
      } else if (e.key === "Escape" && !e.defaultPrevented && !ehCampo(e.target instanceof HTMLElement ? e.target : null) && !document.querySelector("[aria-modal='true']")) {
        // Num campo, o Esc só tira o foco (motor do teclado); um segundo Esc, já fora, descarta.
        // Lê o alvo do evento: o motor pode ter tirado o foco antes deste ouvinte rodar.
        atalhos.current.descartar();
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  const r = f.rascunho;
  const p = f.problemas;
  const campoDe = (c: CampoEditavel) => (el: HTMLElement | null) => {
    campos.current[c] = el;
  };
  const descrito = (c: CampoEditavel, ...outros: string[]) => [p[c] ? `${ids}-${c}-erro` : "", ...outros].filter(Boolean).join(" ") || undefined;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
      className="flex flex-col gap-8"
    >
      <Cartao>
        <Linha rotulo="Nome" para={`${ids}-nome`} ajuda="Como o bot aparece na barra lateral e nas conversas.">
          <input
            id={`${ids}-nome`}
            ref={campoDe("nome")}
            value={r.nome}
            onChange={(e) => editar({ tipo: "editar", campo: "nome", valor: e.target.value })}
            autoComplete="off"
            maxLength={LIMITE.nome + 20}
            aria-invalid={p.nome ? true : undefined}
            aria-describedby={descrito("nome")}
            className={estiloCampo}
          />
          <Problema id={`${ids}-nome-erro`} texto={p.nome} />
        </Linha>
        <Linha rotulo="Descrição" para={`${ids}-descricao`} ajuda="Uma frase sobre o papel dele. Aparece embaixo do nome.">
          <Descricao
            id={`${ids}-descricao`}
            campoRef={campoDe("descricao")}
            valor={r.descricao}
            aoMudar={(v) => editar({ tipo: "editar", campo: "descricao", valor: v })}
            placeholder=""
            invalido={!!p.descricao}
            descrito={descrito("descricao")}
          />
          <Problema id={`${ids}-descricao-erro`} texto={p.descricao} />
        </Linha>
        <Linha rotulo="Setor" para={`${ids}-setor`} ajuda="O grupo do bot na barra lateral, como Marketing ou Comercial.">
          <Setor
            id={`${ids}-setor`}
            valor={r.setor}
            setores={setores}
            aoMudar={(v) => editar({ tipo: "editar", campo: "setor", valor: v })}
            campoRef={campoDe("setor")}
            invalido={!!p.setor}
            descrito={descrito("setor")}
          />
          <Problema id={`${ids}-setor-erro`} texto={p.setor} />
        </Linha>
        <Linha rotulo="Modelo" ajuda="O modelo de IA que responde por este bot.">
          <SeletorDeModelo
            valor={r.modelo}
            salvo={f.salvo.modelo}
            modelos={modelos}
            relerModelos={relerModelos}
            aoMudar={(m) => editar({ tipo: "editar", campo: "modelo", valor: m as Editavel["modelo"] })}
          />
        </Linha>
      </Cartao>

      <Cartao titulo="O que o modelo recebe">
        <Linha
          rotulo="Prompt"
          para={`${ids}-prompt`}
          ajuda="O papel do bot: o que ele faz, em que ordem e o que evita. Escreva como se explicasse a uma pessoa nova na equipe."
        >
          <TextoLongo
            id={`${ids}-prompt`}
            valor={r.prompt}
            limite={LIMITE.prompt}
            problema={p.prompt}
            aoMudar={(v) => editar({ tipo: "editar", campo: "prompt", valor: v })}
            campoRef={campoDe("prompt")}
          />
        </Linha>
        <Linha rotulo="Regras" para={`${ids}-regras`} ajuda="Como usar as ferramentas: o que chamar, em que ordem e quando parar. Entram depois do prompt.">
          <TextoLongo
            id={`${ids}-regras`}
            valor={r.regras}
            limite={LIMITE.regras}
            problema={p.regras}
            aoMudar={(v) => editar({ tipo: "editar", campo: "regras", valor: v })}
            campoRef={campoDe("regras")}
            baixo={!criado}
            placeholder="Sem regras. Escreva aqui como o bot deve usar as ferramentas."
          />
          {r.regras !== f.salvo.regrasPadrao && (
            <button
              type="button"
              onClick={() => editar({ tipo: "editar", campo: "regras", valor: f.salvo.regrasPadrao })}
              className="pressiona self-start rounded-full bg-tinta/[0.06] px-3 py-1.5 text-[13px] font-medium hover:bg-tinta/10"
            >
              {criado ? "Voltar às regras da primeira versão" : "Voltar às regras originais"}
            </button>
          )}
        </Linha>
        {f.salvo.contexto && (
          <Linha rotulo="Brandbook" ajuda="Os capítulos do brandbook e os tokens da marca, gerados da pasta brand. Entram depois das regras.">
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={r.marca}
                onChange={(e) => editar({ tipo: "editar", campo: "marca", valor: e.target.checked })}
                className="size-4 flex-none accent-tinta"
              />
              <span className="text-[13px]">Incluir o brandbook no prompt</span>
            </label>
            <details className="group">
              <summary className="w-fit cursor-pointer list-none text-xs text-tinta-3 hover:text-tinta [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">Ver o texto</span>
                <span className="hidden group-open:inline">Esconder o texto</span>
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto overscroll-contain rounded-[10px] bg-fundo px-3 py-2.5 font-mono text-xs/relaxed whitespace-pre-wrap text-tinta-2">
                {f.salvo.contexto}
              </pre>
            </details>
          </Linha>
        )}
        <Linha
          rotulo="Ferramentas"
          ajuda={criado ? "O que o bot pode fazer além de conversar. Lembrar, que grava na memória, todo bot tem." : "As ferramentas dos bots que vêm com o sistema são definidas no código."}
        >
          {criado ? (
            <Ferramentas marcadas={r.tools} aoMudar={(tools) => editar({ tipo: "editar", campo: "tools", valor: tools })} />
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {[...f.salvo.tools, "lembrar"].map((t) => (
                <li key={t} className="rounded-[6px] bg-ativo px-1.5 py-0.5 font-mono text-xs text-tinta-2">
                  {t}
                </li>
              ))}
            </ul>
          )}
        </Linha>
      </Cartao>
      <p className="-mt-5 px-1 text-[13px] text-pretty text-tinta-3">
        As mudanças valem a partir da próxima mensagem, inclusive nas conversas que já existem. Não precisa reiniciar nada.
      </p>
      <Memoria id={id} inicial={f.salvo.memoria} aoGravar={(m) => setMemoriaEm(m.atualizadaEm)} />
      <PromptFinal id={id} versao={`${f.salvo.versaoId}-${memoriaEm}`} />
      <Versoes id={id} f={f} modelos={modelos} restaurar={restaurar} />
      {criado && <Apagar id={id} nome={f.salvo.nome} />}
      <Barra f={f} salvar={() => void salvar()} descartar={descartar} />
    </form>
  );
}
