import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Pronto } from "../../../agent/fila";
import type { Fonte, Pilar, TipoMidia } from "../../../db";
import type { Teste } from "../../../domain/scheduler/calendar";
import { navegar } from "../../rota";
import { MIDIA, PILARES } from "../peca";
import type { Agenda } from "./agenda";
import { diaDe, diaPorExtenso, epochDe, hoje, minutosDaHora, minutosDe, momentoPorExtenso, somarDias, textoDaHora, type Dia } from "./datas";
import { Alerta, Estrela, Lampada, Relogio, Visto } from "./Evento";
import { ehMovel, PASSADO, remocaoDe, ROTULO_DA_REMOCAO, type AberturaDoRascunho, type ItemNaTela, type Rascunho } from "./eventos";
import { chaveDe, ehDaEquipe, instanteDe, tituloDe, type ItemAgendado, type ItemCalendario, type ItemData, type ItemDataDaEquipe, type ItemPauta, type Lugar } from "./itens";

/** O que o detalhe pede à tela. `fechar` vem do CalendarCN e tira a seleção. */
export interface AcoesDoDetalhe {
  agenda: Agenda;
  prontos: readonly Pronto[] | null;
  fechar: () => void;
  /** Seleciona o item, o que abre o detalhe dele no lugar deste. */
  selecionar: (item: ItemCalendario) => void;
  remover: (item: ItemNaTela) => void;
  /** Abre um rascunho no lugar, já no passo de anotar a ideia. */
  rascunhar: (lugar: Lugar) => void;
  criarComChefe: (pauta: ItemPauta) => void;
}

const rotuloCampo = "text-xs font-medium text-tinta-2";

const campo =
  "h-9 w-full min-w-0 rounded-[10px] bg-superficie px-2.5 text-base text-tinta shadow-[inset_0_0_0_1px_var(--color-borda-campo)] outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--color-tinta)] sm:text-sm";

const botaoPrincipal = "pressiona inline-flex h-9 whitespace-nowrap cursor-pointer items-center justify-center rounded-full bg-tinta px-4 font-medium text-sobre-tinta hover:bg-tinta/85 disabled:cursor-default disabled:opacity-40";

const botaoSecundario = "pressiona inline-flex h-9 whitespace-nowrap cursor-pointer items-center justify-center rounded-full px-3.5 font-medium text-tinta-2 hover:bg-hover hover:text-tinta";

const botaoPerigo = "pressiona inline-flex h-9 whitespace-nowrap cursor-pointer items-center justify-center rounded-full px-3.5 font-medium text-erro hover:bg-erro/8";

const ROTULO_DO_TESTE: Record<Teste, string> = { setor: "Setor", regiao: "Região", empresa: "Empresa" };

const legivel = (p: string) => p.charAt(0) + p.slice(1).toLowerCase();

const chaveDaFonte = (f: Fonte) => (f.tipo === "post" ? `post:${f.postId}` : f.tipo === "arte" ? `arte:${f.arteId}` : `peca:${f.pecaId}`);

/** "Stories", "Feed" ou "Feed ou Stories": o formato em que a peça pode sair. */
const formatosDo = (p: Pronto) => p.midias.map((m) => MIDIA[m]).join(" ou ");

/** O corpo do popover de detalhes do CalendarCN, um por tipo de item. */
export function Detalhes({ item, acoes }: { item: ItemNaTela; acoes: AcoesDoDetalhe }) {
  return <div className="flex flex-col gap-3 p-4 text-sm">{conteudo(item, acoes)}</div>;
}

function conteudo(item: ItemNaTela, acoes: AcoesDoDetalhe) {
  switch (item.tipo) {
    case "rascunho":
      return <Criar key={`${item.lugar.dia} ${item.lugar.minutos} ${item.abreEm}`} rascunho={item} acoes={acoes} />;
    case "pauta":
      return <EditorPauta key={item.id} pauta={item} acoes={acoes} />;
    case "agendado":
      return <DetalheAgendado key={item.filaId} item={item} acoes={acoes} />;
    case "publicado":
      return <DetalhePublicado item={item} />;
    case "data":
      return ehDaEquipe(item) ? <EditorData key={chaveDe(item)} data={item} acoes={acoes} /> : <DetalheData data={item} acoes={acoes} />;
  }
}

function Titulo({ children }: { children: ReactNode }) {
  return <h3 className="text-[15px]/snug font-semibold text-pretty [overflow-wrap:anywhere]">{children}</h3>;
}

const textoDoLugar = (l: Lugar) => (l.minutos === null ? diaPorExtenso(l.dia) : `${diaPorExtenso(l.dia)}, ${textoDaHora(l.minutos)}`);

type PassoDeCriar = AberturaDoRascunho | "agendar" | "data";

/** O espaço vazio clicado: primeiro a escolha entre anotar uma ideia, agendar o que está pronto e marcar uma data, depois o passo escolhido. */
function Criar({ rascunho, acoes }: { rascunho: Rascunho; acoes: AcoesDoDetalhe }) {
  const [passo, setPasso] = useState<PassoDeCriar>(rascunho.abreEm);
  const [veioDe, setVeioDe] = useState<PassoDeCriar | null>(null);
  const voltar = () => (setVeioDe(passo), setPasso("escolha"));

  return (
    <>
      <Titulo>{textoDoLugar(rascunho.lugar)}</Titulo>
      {passo === "escolha" && <Escolha prontos={acoes.prontos} veioDe={veioDe} escolher={setPasso} fechar={acoes.fechar} />}
      {passo === "ideia" && <NovaPauta lugar={rascunho.lugar} acoes={acoes} voltar={voltar} />}
      {passo === "agendar" && <EscolherPronto lugar={rascunho.lugar} acoes={acoes} voltar={voltar} />}
      {passo === "data" && <NovaData dia={rascunho.lugar.dia} acoes={acoes} voltar={voltar} />}
    </>
  );
}

const plural = new Intl.PluralRules("pt-BR");

function situacaoDosProntos(prontos: readonly Pronto[] | null): string {
  if (prontos === null) return "Carregando…";
  if (prontos.length === 0) return "Nada pronto. As artes prontas aparecem aqui.";
  return plural.select(prontos.length) === "one" ? "1 pronta para publicar" : `${prontos.length} prontas para publicar`;
}

interface PropsDaEscolha {
  prontos: readonly Pronto[] | null;
  /** O passo de onde o Voltar trouxe, que recebe o foco de volta. */
  veioDe: PassoDeCriar | null;
  escolher: (p: PassoDeCriar) => void;
  fechar: () => void;
}

function Escolha({ prontos, veioDe, escolher, fechar }: PropsDaEscolha) {
  const lista = useRef<HTMLUListElement>(null);
  // Na abertura o foco entra na lista, sem marcar opção nenhuma; o Tab segue para a primeira.
  useEffect(() => {
    if (!veioDe) lista.current?.focus({ preventScroll: true });
  }, [veioDe]);

  return (
    <>
      <ul ref={lista} tabIndex={-1} aria-label="O que criar" className="-mx-2 flex flex-col gap-0.5 outline-none">
        <OpcaoDeCriar icone={<Lampada tamanho={16} />} titulo="Anotar uma ideia" detalhe="O Chefe faz o post depois" focar={veioDe === "ideia"} aoEscolher={() => escolher("ideia")} />
        <OpcaoDeCriar
          icone={<Relogio tamanho={16} />}
          titulo="Agendar uma arte pronta"
          detalhe={situacaoDosProntos(prontos)}
          focar={veioDe === "agendar"}
          indisponivel={!prontos?.length}
          aoEscolher={() => escolher("agendar")}
        />
        <OpcaoDeCriar icone={<Estrela tamanho={16} />} titulo="Feriado ou data" detalhe="Os bots usam para sugerir post" focar={veioDe === "data"} aoEscolher={() => escolher("data")} />
      </ul>
      {prontos?.length === 0 && (
        <button type="button" onClick={() => (fechar(), navegar("/biblioteca"))} className={`${botaoSecundario} self-end`}>
          Abrir a Biblioteca
        </button>
      )}
    </>
  );
}

interface PropsDaOpcao {
  icone: ReactNode;
  titulo: string;
  detalhe: string;
  focar: boolean;
  indisponivel?: boolean;
  aoEscolher: () => void;
}

function OpcaoDeCriar({ icone, titulo, detalhe, focar, indisponivel, aoEscolher }: PropsDaOpcao) {
  const id = useId();
  return (
    <li>
      <button
        type="button"
        autoFocus={focar && !indisponivel}
        disabled={indisponivel}
        aria-describedby={id}
        onClick={aoEscolher}
        className="pressiona-leve group flex w-full cursor-pointer items-center gap-3 rounded-[10px] p-2 text-left enabled:hover:bg-hover disabled:cursor-default"
      >
        <span className="grid size-9 flex-none place-items-center rounded-[9px] bg-hover text-tinta group-disabled:text-tinta-3">{icone}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13px]/snug font-medium group-disabled:text-tinta-3">{titulo}</span>
          <span id={id} className="text-xs text-pretty text-tinta-3">
            {detalhe}
          </span>
        </span>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-none text-tinta-3 group-disabled:hidden">
          <path d="m4.5 2.5 3.5 3.5-3.5 3.5" />
        </svg>
      </button>
    </li>
  );
}

function NovaPauta({ lugar, acoes, voltar }: { lugar: Lugar; acoes: AcoesDoDetalhe; voltar: () => void }) {
  const id = useId();
  const [titulo, setTitulo] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const limpo = titulo.trim();
    if (!limpo || enviando) return;

    setEnviando(true);
    const nova = await acoes.agenda.criarPauta({ dia: lugar.dia, hora: lugar.minutos === null ? null : textoDaHora(lugar.minutos), titulo: limpo });
    setEnviando(false);
    if (nova) acoes.selecionar(nova);
  }

  return (
    <form onSubmit={criar} className="flex flex-col gap-3">
      <label htmlFor={`${id}-titulo`} className="flex flex-col gap-1">
        <span className={rotuloCampo}>Ideia</span>
        <input
          id={`${id}-titulo`}
          autoFocus
          required
          value={titulo}
          onChange={(e) => setTitulo(e.target.value)}
          placeholder="Box de vidro entregue no Calhau"
          maxLength={200}
          autoComplete="off"
          aria-describedby={`${id}-ajuda`}
          className={campo}
        />
      </label>
      <p id={`${id}-ajuda`} className="text-xs text-pretty text-tinta-3">
        Fica marcada no dia. Depois o Chefe transforma em post.
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={voltar} className={botaoSecundario}>
          Voltar
        </button>
        <button type="submit" disabled={enviando} className={botaoPrincipal}>
          {enviando ? "Anotando…" : "Anotar"}
        </button>
      </div>
    </form>
  );
}

function Testes({ nome, valor, aoMudar }: { nome: string; valor: Teste; aoMudar: (t: Teste) => void }) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className={`${rotuloCampo} mb-1`}>Tipo</legend>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(ROTULO_DO_TESTE) as Teste[]).map((t) => (
          <label key={t} data-tom="nenhum" className="cal-chip">
            <input type="radio" name={nome} checked={valor === t} onChange={() => aoMudar(t)} className="sr-only" />
            {ROTULO_DO_TESTE[t]}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RepeteTodoAno({ marcado, aoMudar }: { marcado: boolean; aoMudar: (repete: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-tinta">
      <input type="checkbox" checked={marcado} onChange={(e) => aoMudar(e.target.checked)} className="size-4 accent-[var(--color-tinta)]" />
      Repete todo ano
    </label>
  );
}

const anoDe = (dia: Dia) => Number(dia.slice(0, 4));

/** O dia vem do clique. Os bots passam a ver a data no proximas_datas. */
function NovaData({ dia, acoes, voltar }: { dia: Dia; acoes: AcoesDoDetalhe; voltar: () => void }) {
  const id = useId();
  const [nome, setNome] = useState("");
  const [anual, setAnual] = useState(true);
  const [teste, setTeste] = useState<Teste>("empresa");
  const [porque, setPorque] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const limpo = nome.trim();
    if (!limpo || enviando) return;

    setEnviando(true);
    const nova = await acoes.agenda.criarData(dia, { nome: limpo, ano: anual ? null : anoDe(dia), teste, porque: porque.trim() });
    setEnviando(false);
    if (nova) acoes.selecionar(nova);
  }

  return (
    <form onSubmit={criar} className="flex flex-col gap-3">
      <label htmlFor={`${id}-nome`} className="flex flex-col gap-1">
        <span className={rotuloCampo}>Nome</span>
        <input id={`${id}-nome`} autoFocus required value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Aniversário de Raposa" maxLength={120} autoComplete="off" className={campo} />
      </label>
      <RepeteTodoAno marcado={anual} aoMudar={setAnual} />
      <Testes nome={`${id}-teste`} valor={teste} aoMudar={setTeste} />
      <label htmlFor={`${id}-porque`} className="flex flex-col gap-1">
        <span className={rotuloCampo}>Por que importa (opcional)</span>
        <input id={`${id}-porque`} value={porque} onChange={(e) => setPorque(e.target.value)} placeholder="Matriz em Raposa-MA" maxLength={500} autoComplete="off" className={campo} />
      </label>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={voltar} className={botaoSecundario}>
          Voltar
        </button>
        <button type="submit" disabled={enviando} className={botaoPrincipal}>
          {enviando ? "Criando…" : "Criar"}
        </button>
      </div>
    </form>
  );
}

function EscolherPronto({ lugar, acoes, voltar }: { lugar: Lugar; acoes: AcoesDoDetalhe; voltar: () => void }) {
  const [escolhido, setEscolhido] = useState<Pronto | null>(null);
  const [ultimo, setUltimo] = useState<string | null>(null);
  if (escolhido) return <FormAgendar pronto={escolhido} lugar={lugar} acoes={acoes} voltar={() => setEscolhido(null)} />;

  const prontos = acoes.prontos ?? [];
  const focado = ultimo ?? (prontos[0] && chaveDaFonte(prontos[0].fonte));
  return (
    <>
      {prontos.length === 0 ? (
        <p className="text-tinta-2">Nada pronto para agendar.</p>
      ) : (
        <ul aria-label="Artes prontas" className="-mx-2 flex max-h-[min(320px,45dvh)] flex-col gap-0.5 overflow-y-auto overscroll-contain">
          {prontos.map((p) => {
            const chave = chaveDaFonte(p.fonte);
            return (
              <li key={chave}>
                <button
                  type="button"
                  autoFocus={chave === focado}
                  onClick={() => (setUltimo(chave), setEscolhido(p))}
                  className="pressiona-leve flex w-full cursor-pointer items-center gap-3 rounded-[10px] p-2 text-left hover:bg-hover"
                >
                  <Capa url={p.capa} />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="line-clamp-2 text-[13px]/snug font-medium text-pretty [overflow-wrap:anywhere]">{p.titulo}</span>
                    <span className="truncate text-xs text-tinta-3">{p.pilar ? `${legivel(p.pilar)} · ${formatosDo(p)}` : formatosDo(p)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={voltar} className={`${botaoSecundario} self-end`}>
        Voltar
      </button>
    </>
  );
}

function Capa({ url, grande }: { url: string | null; grande?: boolean }) {
  if (!url) return null;
  return <img src={url} alt="" loading="lazy" decoding="async" className={`flex-none rounded-[8px] object-cover outline outline-1 -outline-offset-1 outline-black/10 ${grande ? "h-20 w-16" : "h-12 w-[38px]"}`} />;
}

function Cabecalho({ capa, titulo, linha }: { capa: string | null; titulo: string; linha: ReactNode }) {
  return (
    <div className="flex gap-3">
      <Capa url={capa} grande />
      <div className="flex min-w-0 flex-col gap-1">
        <Titulo>{titulo}</Titulo>
        <p className="text-[13px] text-tinta-2">{linha}</p>
      </div>
    </div>
  );
}

interface PropsDosCampos {
  dia: Dia;
  hora: string;
  aoDia: (d: Dia) => void;
  aoHora: (h: string) => void;
  aoSairDaHora?: () => void;
  horaOpcional?: boolean;
  focar?: boolean;
}

function Campos({ dia, hora, aoDia, aoHora, aoSairDaHora, horaOpcional, focar }: PropsDosCampos) {
  const id = useId();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-2">
      <label htmlFor={`${id}-dia`} className="flex flex-col gap-1">
        <span className={rotuloCampo}>Dia</span>
        <input id={`${id}-dia`} type="date" required autoFocus={focar} value={dia} onChange={(e) => e.target.value && aoDia(e.target.value as Dia)} className={`${campo} tabular`} />
      </label>
      <label htmlFor={`${id}-hora`} className="flex flex-col gap-1">
        <span className={rotuloCampo}>{horaOpcional ? "Hora (opcional)" : "Hora"}</span>
        <input id={`${id}-hora`} type="time" step={900} required={!horaOpcional} value={hora} onChange={(e) => aoHora(e.target.value)} onBlur={aoSairDaHora} className={`${campo} tabular`} />
      </label>
    </div>
  );
}

/** A confirmação de agendar: dia, hora, a mídia quando a peça tem as duas e a legenda do feed. */
function FormAgendar({ pronto, lugar, acoes, voltar }: { pronto: Pronto; lugar: Lugar; acoes: AcoesDoDetalhe; voltar: () => void }) {
  const id = useId();

  const [dia, setDia] = useState<Dia>(lugar.dia);
  const [hora, setHora] = useState(textoDaHora(lugar.minutos ?? 18 * 60));
  const [midia, setMidia] = useState<TipoMidia>(pronto.midias[0] ?? "IMAGE");
  const [legenda, setLegenda] = useState(pronto.legenda ?? "");

  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const minutos = minutosDaHora(hora);
  const publicaEm = minutos === null ? null : epochDe(dia, minutos);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (publicaEm === null) return setErro("Escolha uma hora.");
    if (publicaEm <= Date.now()) return setErro(PASSADO);

    setErro(null);
    setEnviando(true);
    const falha = await acoes.agenda.agendar({ fonte: pronto.fonte, midia, publicaEm, legenda: midia === "IMAGE" ? legenda : undefined });
    setEnviando(false);
    if (falha) return setErro(falha);

    acoes.fechar();
  }

  return (
    <form onSubmit={enviar} className="flex flex-col gap-3">
      <Cabecalho capa={pronto.capa} titulo={pronto.titulo} linha={formatosDo(pronto)} />
      <Campos dia={dia} hora={hora} aoDia={setDia} aoHora={setHora} focar />
      {pronto.midias.length > 1 && (
        <fieldset className="flex flex-col gap-1">
          <legend className={`${rotuloCampo} mb-1`}>Mídia</legend>
          <div className="flex gap-1.5">
            {pronto.midias.map((m) => (
              <label key={m} data-tom="nenhum" className="cal-chip">
                <input type="radio" name={`${id}-midia`} checked={midia === m} onChange={() => setMidia(m)} className="sr-only" />
                {MIDIA[m]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {midia === "IMAGE" && (
        <label htmlFor={`${id}-legenda`} className="flex flex-col gap-1">
          <span className={rotuloCampo}>Legenda (opcional)</span>
          <textarea
            id={`${id}-legenda`}
            value={legenda}
            onChange={(e) => setLegenda(e.target.value)}
            rows={3}
            maxLength={2200}
            placeholder="O texto que vai embaixo da imagem no feed"
            className={`${campo} h-auto max-h-[30dvh] min-h-[4.5rem] resize-none overflow-y-auto py-2 leading-snug [field-sizing:content] [overflow-wrap:anywhere]`}
          />
        </label>
      )}
      <p role="alert" className="text-[13px] text-erro empty:hidden">
        {erro}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={voltar} className={botaoSecundario}>
          Voltar
        </button>
        <button type="submit" disabled={enviando} className={botaoPrincipal}>
          {enviando ? "Agendando…" : "Agendar"}
        </button>
      </div>
    </form>
  );
}

/**
 * Pauta é a ideia marcada no dia; o post sai da conversa com o Chefe. Cada campo grava ao sair
 * dele, como o título de um evento no Notion Calendar. Dia e hora ficam aqui porque o arrasto
 * não troca pauta com hora por pauta do dia inteiro.
 */
function EditorPauta({ pauta, acoes }: { pauta: ItemPauta; acoes: AcoesDoDetalhe }) {
  const id = useId();
  const [titulo, setTitulo] = useState(pauta.titulo);
  const [nota, setNota] = useState(pauta.nota);

  const [dia, setDia] = useState<Dia>(pauta.dia);
  const [hora, setHora] = useState(pauta.hora ?? "");
  const [erro, setErro] = useState<string | null>(null);

  function gravarTitulo() {
    const limpo = titulo.trim();
    if (!limpo) return setTitulo(pauta.titulo);
    if (limpo !== pauta.titulo) void acoes.agenda.mudarPauta(pauta, { titulo: limpo });
  }

  function gravarLugar(novoDia: Dia, novaHora: string) {
    const minutos = novaHora ? minutosDaHora(novaHora) : null;
    const lugar: Lugar = { dia: novoDia, minutos };
    const igual = novoDia === pauta.dia && (minutos === null ? null : novaHora) === pauta.hora;
    if (igual || (novaHora && minutos === null)) return setErro(null);
    if (instanteDe(lugar) <= Date.now()) return setErro(PASSADO);

    setErro(null);
    void acoes.agenda.mover(pauta, lugar);
  }

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-tinta-3">
          <Lampada />
          Ideia de post
        </span>
        <label htmlFor={`${id}-titulo`} className="flex flex-col">
          <span className="sr-only">Ideia</span>
          <textarea
            id={`${id}-titulo`}
            value={titulo}
            rows={1}
            onChange={(e) => setTitulo(e.target.value.replace(/\n/g, " "))}
            onBlur={gravarTitulo}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.preventDefault(), e.currentTarget.blur())}
            maxLength={200}
            className="-mx-1.5 resize-none rounded-[8px] px-1.5 py-1 text-[15px]/snug font-semibold outline-none [field-sizing:content] [overflow-wrap:anywhere] hover:bg-hover focus-visible:bg-hover"
          />
        </label>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className={`${rotuloCampo} mb-1`}>Pilar</legend>
        <div className="flex flex-wrap gap-1.5">
          {[null, ...PILARES].map((p: Pilar | null) => (
            <label key={p ?? "nenhum"} data-tom={p ?? "nenhum"} className="cal-chip">
              <input type="radio" name={`${id}-pilar`} checked={pauta.pilar === p} onChange={() => void acoes.agenda.mudarPauta(pauta, { pilar: p })} className="sr-only" />
              {p ? legivel(p) : "Nenhum"}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={`${id}-nota`} className="flex flex-col gap-1">
        <span className={rotuloCampo}>Nota</span>
        <textarea
          id={`${id}-nota`}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          onBlur={() => nota.trim() !== pauta.nota && void acoes.agenda.mudarPauta(pauta, { nota: nota.trim() })}
          rows={3}
          maxLength={5000}
          className={`${campo} h-auto max-h-[40dvh] min-h-[4.5rem] resize-none overflow-y-auto py-2 leading-snug [field-sizing:content] [overflow-wrap:anywhere]`}
        />
      </label>
      <Campos
        dia={dia}
        hora={hora}
        aoDia={(d) => {
          setDia(d);
          gravarLugar(d, hora);
        }}
        aoHora={setHora}
        aoSairDaHora={() => gravarLugar(dia, hora)}
        horaOpcional
      />
      <p role="alert" className="text-[13px] text-erro empty:hidden">
        {erro}
      </p>
      <div className="flex flex-col gap-1 pt-1">
        <button type="button" onClick={() => (acoes.fechar(), acoes.criarComChefe(pauta))} className={botaoPrincipal}>
          {pauta.conversaId ? "Abrir a conversa" : "Fazer o post com o Chefe"}
        </button>
        <button type="button" onClick={() => acoes.remover(pauta)} className={`${botaoPerigo} self-start -ml-3.5`}>
          Apagar
        </button>
      </div>
    </>
  );
}

/** O erro da Meta vem cru, em inglês: os casos conhecidos ganham o que fazer, o resto mostra o texto. */
function explicarFalha(erro: string | null): string {
  if (erro && /access token|#190|session has expired|oauth/i.test(erro)) return "O acesso ao Instagram expirou. Reconecte a conta do Instagram e agende o post de novo.";
  if (erro && /propor|aspect ratio/i.test(erro)) return "O Instagram recusou a proporção da imagem. Ajuste a peça e agende de novo.";
  return "O Instagram recusou a publicação. Confira o motivo abaixo e agende de novo.";
}

function DetalheAgendado({ item, acoes }: { item: ItemAgendado; acoes: AcoesDoDetalhe }) {
  const cabecalho = <Cabecalho capa={item.capa} titulo={tituloDe(item)} linha={`${MIDIA[item.midia]} · ${momentoPorExtenso(item.publicaEm)}`} />;
  switch (item.status) {
    case "failed":
      return <Falhou item={item} cabecalho={cabecalho} acoes={acoes} />;
    case "publishing":
      return (
        <>
          {cabecalho}
          <p className="flex items-center gap-1.5 text-tinta-2">
            <Relogio />
            Publicando agora.
          </p>
        </>
      );
    case "pending":
      return <MudarHorario item={item} cabecalho={cabecalho} acoes={acoes} />;
  }
}

function Falhou({ item, cabecalho, acoes }: { item: ItemAgendado; cabecalho: ReactNode; acoes: AcoesDoDetalhe }) {
  const [deNovo, setDeNovo] = useState(false);
  const pronto = acoes.prontos?.find((p) => chaveDaFonte(p.fonte) === chaveDaFonte(item.fonte) && p.midias.includes(item.midia)) ?? null;
  // De novo no mesmo horário se ainda dá; se já passou, amanhã na mesma hora.
  const novo = item.publicaEm > Date.now() ? item.publicaEm : epochDe(somarDias(hoje(), 1), minutosDe(item.publicaEm));
  if (deNovo && pronto) return <FormAgendar pronto={pronto} lugar={{ dia: diaDe(novo), minutos: minutosDe(novo) }} acoes={acoes} voltar={() => setDeNovo(false)} />;

  return (
    <>
      {cabecalho}
      <div role="note" className="flex flex-col gap-1.5 rounded-[12px] bg-erro/6 p-3">
        <span className="flex items-center gap-1.5 font-medium text-erro">
          <Alerta />A publicação falhou
        </span>
        <p className="text-[13px] text-pretty text-tinta">{explicarFalha(item.erro)}</p>
        {item.erro && <p className="line-clamp-4 text-xs text-tinta-2 [overflow-wrap:anywhere]">{item.erro}</p>}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => acoes.remover(item)} className={botaoSecundario}>
          Dispensar
        </button>
        {pronto && (
          <button type="button" onClick={() => setDeNovo(true)} className={botaoPrincipal}>
            Agendar de novo
          </button>
        )}
      </div>
    </>
  );
}

function MudarHorario({ item, cabecalho, acoes }: { item: ItemAgendado; cabecalho: ReactNode; acoes: AcoesDoDetalhe }) {
  const [dia, setDia] = useState<Dia>(diaDe(item.publicaEm));
  const [hora, setHora] = useState(textoDaHora(minutosDe(item.publicaEm)));
  const [erro, setErro] = useState<string | null>(null);

  const minutos = minutosDaHora(hora);
  const mudou = minutos !== null && epochDe(dia, minutos) !== item.publicaEm;
  const remocao = remocaoDe(item);

  function mudar(e: React.FormEvent) {
    e.preventDefault();
    if (minutos === null || !ehMovel(item)) return;
    if (epochDe(dia, minutos) <= Date.now()) return setErro(PASSADO);

    void acoes.agenda.mover(item, { dia, minutos });
  }

  return (
    <form onSubmit={mudar} className="flex flex-col gap-3">
      {cabecalho}
      <Campos dia={dia} hora={hora} aoDia={(d) => (setDia(d), setErro(null))} aoHora={(h) => (setHora(h), setErro(null))} />
      <p className="text-[13px] text-pretty text-tinta-2">Arraste no calendário ou troque o dia e a hora aqui.</p>
      <p role="alert" className="text-[13px] text-erro empty:hidden">
        {erro}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {remocao && (
          <button type="button" onClick={() => acoes.remover(item)} className={botaoPerigo}>
            {ROTULO_DA_REMOCAO[remocao.acao]}
          </button>
        )}
        <button type="submit" disabled={!mudou} className={botaoPrincipal}>
          Mudar horário
        </button>
      </div>
    </form>
  );
}

function DetalhePublicado({ item }: { item: Extract<ItemCalendario, { tipo: "publicado" }> }) {
  return (
    <>
      <Cabecalho
        capa={item.capa}
        titulo={tituloDe(item)}
        linha={
          <span className="flex items-center gap-1.5">
            <Visto />
            Publicado · {MIDIA[item.midia]} · {momentoPorExtenso(item.publicadoEm)}
          </span>
        }
      />
      {item.link && (
        <a href={item.link} target="_blank" rel="noreferrer" className={`${botaoSecundario} self-end`}>
          Abrir no Instagram
        </a>
      )}
    </>
  );
}

/** As datas fixas do código. Mudar uma delas é mudar o código, por isso a tela só mostra. */
function DetalheData({ data, acoes }: { data: ItemData; acoes: AcoesDoDetalhe }) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <Titulo>{data.nome}</Titulo>
        <p className="text-[13px] text-tinta-2">
          {diaPorExtenso(data.dia)} · {ROTULO_DO_TESTE[data.teste]}
        </p>
      </div>
      {data.porque && <p className="text-[13px] text-pretty text-tinta-2">{data.porque}</p>}
      <p className="text-xs text-pretty text-tinta-3">Data fixa do calendário editorial. Não dá para editar nem apagar pela tela.</p>
      <button type="button" onClick={() => acoes.rascunhar({ dia: data.dia, minutos: null })} className={`${botaoSecundario} self-end`}>
        Anotar uma ideia neste dia
      </button>
    </>
  );
}

/** Feriado ou data que a equipe cadastrou. Cada campo grava ao sair dele, como na pauta. */
function EditorData({ data, acoes }: { data: ItemDataDaEquipe; acoes: AcoesDoDetalhe }) {
  const id = useId();
  const [nome, setNome] = useState(data.nome);
  const [porque, setPorque] = useState(data.porque);

  function gravarNome() {
    const limpo = nome.trim();
    if (!limpo) return setNome(data.nome);
    if (limpo !== data.nome) void acoes.agenda.mudarData(data, { nome: limpo });
  }

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-tinta-3">
          <Estrela />
          Feriado ou data · {diaPorExtenso(data.dia)}
        </span>
        <label htmlFor={`${id}-nome`} className="flex flex-col">
          <span className="sr-only">Nome</span>
          <textarea
            id={`${id}-nome`}
            value={nome}
            rows={1}
            onChange={(e) => setNome(e.target.value.replace(/\n/g, " "))}
            onBlur={gravarNome}
            onKeyDown={(e) => e.key === "Enter" && !e.nativeEvent.isComposing && (e.preventDefault(), e.currentTarget.blur())}
            maxLength={120}
            className="-mx-1.5 resize-none rounded-[8px] px-1.5 py-1 text-[15px]/snug font-semibold outline-none [field-sizing:content] [overflow-wrap:anywhere] hover:bg-hover focus-visible:bg-hover"
          />
        </label>
      </div>
      <RepeteTodoAno marcado={data.ano === null} aoMudar={(repete) => void acoes.agenda.mudarData(data, { ano: repete ? null : anoDe(data.dia) })} />
      <Testes nome={`${id}-teste`} valor={data.teste} aoMudar={(teste) => void acoes.agenda.mudarData(data, { teste })} />
      <label htmlFor={`${id}-porque`} className="flex flex-col gap-1">
        <span className={rotuloCampo}>Por que importa</span>
        <input
          id={`${id}-porque`}
          value={porque}
          onChange={(e) => setPorque(e.target.value)}
          onBlur={() => porque.trim() !== data.porque && void acoes.agenda.mudarData(data, { porque: porque.trim() })}
          maxLength={500}
          autoComplete="off"
          className={campo}
        />
      </label>
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <button type="button" onClick={() => acoes.remover(data)} className={`${botaoPerigo} -ml-3.5`}>
          Apagar
        </button>
        <button type="button" onClick={() => acoes.rascunhar({ dia: data.dia, minutos: null })} className={botaoSecundario}>
          Anotar uma ideia neste dia
        </button>
      </div>
    </>
  );
}
