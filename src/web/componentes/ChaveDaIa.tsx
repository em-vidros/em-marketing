import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { EstadoDaChave, Provedor } from "../../domain/chaves";
import { apiChaves } from "../api";
import { MOLA, SAIDA } from "../movimento";

const PAINEL_DA_OPENAI = "https://platform.openai.com/api-keys";

const dia = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", timeZone: "America/Sao_Paulo" });
const quando = (em: number) => dia.format(em).replace(".", "");
const primeiroNome = (nome: string) => nome.split(" ")[0] ?? nome;

/** Parece uma chave do provedor? Só a forma; quem decide é o servidor, que testa na API. */
const pareceChave = (p: Provedor, s: string) => (p === "openai" ? /^sk-[A-Za-z0-9_-]{20,}$/ : /^sk-ant-[A-Za-z0-9_-]{20,}$/).test(s.trim());

function useChaves() {
  const [chaves, setChaves] = useState<EstadoDaChave[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    apiChaves
      .listar()
      .then(setChaves)
      .catch((e: Error) => setErro(e.message));
  }, []);

  const trocar = (novo: EstadoDaChave) => setChaves((cs) => cs?.map((c) => (c.provedor === novo.provedor ? novo : c)) ?? [novo]);

  /** Devolve a recusa do servidor em texto, ou null se conectou. */
  const conectar = useCallback(async (p: Provedor, chave: string): Promise<string | null> => {
    try {
      trocar(await apiChaves.conectar(p, chave));
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }, []);

  const desconectar = useCallback(async (p: Provedor) => trocar(await apiChaves.desconectar(p)), []);

  return { chaves, erro, conectar, desconectar };
}


/** Três passos para quem nunca abriu o painel da OpenAI. Depois de conectar, vira um recibo. */
export function ChaveDaIa() {
  const { chaves, erro, conectar, desconectar } = useChaves();
  const openai = chaves?.find((c) => c.provedor === "openai");
  const [guiando, setGuiando] = useState(false);
  const [acabou, setAcabou] = useState(false);

  if (erro) return <p className="rounded-cartao bg-painel p-4 text-sm text-erro">{erro}</p>;
  if (!openai) return <section aria-busy="true" className="h-[320px] rounded-cartao bg-painel" />;

  const tela = guiando || openai.origem === "nenhuma" ? "passos" : openai.origem === "equipe" ? "recibo" : "servidor";

  return (
    <Troca tela={tela}>
      {tela === "recibo" && openai.origem === "equipe" ? (
        <Recibo chave={openai} recemConectada={acabou} trocar={() => setGuiando(true)} desconectar={() => desconectar("openai")} />
      ) : tela === "servidor" && openai.origem === "ambiente" ? (
        <section className="flex flex-col gap-4 rounded-cartao bg-painel p-4 sm:p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">O app usa a chave do servidor</h2>
            <p className="text-sm text-tinta-2">Termina em {openai.final}. Só quem tem acesso à Vercel troca essa chave.</p>
          </div>
          <button type="button" onClick={() => setGuiando(true)} className="pressiona h-10 self-start rounded-item bg-tinta px-4 text-sm font-medium text-sobre-tinta">
            Conectar a chave da equipe
          </button>
        </section>
      ) : (
        <Passos
          podeCancelar={openai.origem !== "nenhuma"}
          cancelar={() => setGuiando(false)}
          conectar={async (c) => {
            const r = await conectar("openai", c);
            if (!r) {
              setGuiando(false);
              setAcabou(true);
            }
            return r;
          }}
        />
      )}
    </Troca>
  );
}

/**
 * O cartão cresce ou encolhe na altura do conteúdo novo, e o que vem embaixo acompanha em vez de
 * pular. Na primeira pintura nada anima. Com movimento reduzido só a opacidade muda.
 */
function Troca({ tela, children }: { tela: string; children: ReactNode }) {
  const reduzir = useReducedMotion();
  const conteudo = useRef<HTMLDivElement>(null);
  const [altura, setAltura] = useState<number | "auto">("auto");
  const primeira = useRef(tela);

  useLayoutEffect(() => {
    const el = conteudo.current;
    if (!el) return;
    const medir = () => setAltura(el.offsetHeight);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const entrou = primeira.current !== tela;
  return (
    <motion.div initial={false} animate={{ height: altura }} transition={reduzir ? { duration: 0 } : MOLA} className="overflow-clip rounded-cartao">
      <div ref={conteudo}>
        <motion.div key={tela} initial={entrou ? { opacity: 0, y: reduzir ? 0 : 6 } : false} animate={{ opacity: 1, y: 0 }} transition={SAIDA}>
          {children}
        </motion.div>
      </div>
    </motion.div>
  );
}

function Passo({ n, titulo, children, feito = false }: { n: number; titulo: string; children: ReactNode; feito?: boolean }) {
  return (
    <li className="grid grid-cols-[28px_1fr] gap-x-3 gap-y-1.5">
      <span
        aria-hidden
        className={`tabular flex size-7 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-150 ${feito ? "bg-trabalhando text-white" : "bg-superficie text-tinta shadow-[0_0_0_1px_var(--color-linha-forte)]"}`}
      >
        {feito ? "✓" : n}
      </span>
      <h3 className="self-center text-sm font-medium">{titulo}</h3>
      <div className="col-start-2 text-sm text-tinta-2">{children}</div>
    </li>
  );
}

function Passos({ conectar, podeCancelar, cancelar }: { conectar: (c: string) => Promise<string | null>; podeCancelar: boolean; cancelar: () => void }) {
  const [abriu, setAbriu] = useState(false);
  const [valor, setValor] = useState("");
  const [recusa, setRecusa] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const ok = pareceChave("openai", valor);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setRecusa(await conectar(valor));
    setEnviando(false);
  }

  return (
    <section className="flex flex-col gap-5 rounded-cartao bg-painel p-4 sm:p-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Conecte uma chave da OpenAI</h2>
        <p className="text-sm text-tinta-2">O uso passa a ser cobrado na conta dona da chave.</p>
      </div>

      <ol className="flex flex-col gap-5">
        <Passo n={1} titulo="Abra o painel de chaves da OpenAI" feito={abriu}>
          Entre com a conta que vai pagar o uso.{" "}
          <a href={PAINEL_DA_OPENAI} target="_blank" rel="noreferrer" onClick={() => setAbriu(true)} className="font-medium text-trabalhando-texto underline underline-offset-2">
            Abrir platform.openai.com
          </a>
        </Passo>
        <Passo n={2} titulo="Crie uma chave chamada EM Marketing" feito={abriu && valor.length > 0}>
          Clique em <span className="font-medium text-tinta">Create new secret key</span>, dê o nome EM Marketing e copie a chave. Ela só aparece uma vez.
        </Passo>
        <Passo n={3} titulo="Cole a chave aqui" feito={ok && !recusa}>
          <form onSubmit={enviar} className="mt-1 flex flex-col gap-2">
            <label className="sr-only" htmlFor="chave-guiada">
              Chave da OpenAI
            </label>
            <input
              id="chave-guiada"
              type="password"
              autoComplete="off"
              spellCheck={false}
              autoFocus={podeCancelar}
              placeholder="sk-proj-..."
              value={valor}
              onChange={(e) => {
                setValor(e.target.value);
                setRecusa(null);
              }}
              aria-invalid={recusa ? true : undefined}
              aria-describedby="chave-guiada-status"
              className="h-11 w-full rounded-item border border-borda-campo bg-superficie px-3 font-mono text-[13px] outline-none focus:border-tinta aria-invalid:border-erro"
            />
            <p id="chave-guiada-status" role={recusa ? "alert" : undefined} className={`min-h-4 text-xs ${recusa ? "text-erro" : "text-tinta-3"}`}>
              {recusa ?? (valor && !ok ? "A chave começa com sk-." : null)}
            </p>
            <div className="flex gap-2">
              <button type="submit" disabled={!ok || enviando} className="pressiona h-10 rounded-item bg-tinta px-4 text-sm font-medium text-sobre-tinta disabled:opacity-40">
                {enviando ? "Testando na OpenAI…" : "Testar e conectar"}
              </button>
              {podeCancelar && (
                <button type="button" onClick={cancelar} className="pressiona h-10 rounded-item px-3 text-sm text-tinta-2 hover:bg-hover hover:text-tinta">
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </Passo>
      </ol>
    </section>
  );
}

function Recibo({ chave, recemConectada, trocar, desconectar }: { chave: Extract<EstadoDaChave, { origem: "equipe" }>; recemConectada: boolean; trocar: () => void; desconectar: () => void }) {
  return (
    <section className="flex flex-col gap-4 rounded-cartao bg-painel p-4 sm:p-6">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={`flex size-9 flex-none items-center justify-center rounded-full bg-trabalhando text-base text-white ${recemConectada ? "animate-in zoom-in-75 fade-in duration-300 ease-out motion-reduce:animate-none" : ""}`}
        >
          ✓
        </span>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">{recemConectada ? "Pronto, a chave está conectada" : "O app roda na chave da equipe"}</h2>
          <p className="text-sm text-tinta-2">
            Artes, legendas e os bots usam a chave que termina em <span className="font-mono text-tinta">{chave.final}</span>, conectada por {primeiroNome(chave.por.nome)} em{" "}
            {quando(chave.em)}. O gasto sai da conta dona da chave na OpenAI.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pl-12">
        <button type="button" onClick={trocar} className="pressiona h-8 rounded-full bg-superficie px-3.5 text-sm font-medium shadow-[0_0_0_1px_var(--color-linha-forte)] hover:bg-hover">
          Trocar chave
        </button>
        <button type="button" onClick={desconectar} className="pressiona h-8 rounded-full px-3 text-sm text-tinta-2 hover:bg-hover hover:text-tinta">
          Desconectar
        </button>
      </div>
    </section>
  );
}
