import { useEffect, useRef, useState } from "react";
import { apiPecasProntas, useApi, type PecaProntaDaApi } from "../api";
import { mostrarAviso } from "./menu/Avisos";
import { ariaDe, ehMac } from "../teclado/atalhos";
import { ehAprovacao, faseDa, type Mensagem, type ParteAprovacao } from "../tipos";
import { COR_DO_ROTULO, IconeDaFase } from "./ia/LinhaFerramenta";
import { Teclas } from "./menu/Teclas";

const MIDIA = { IMAGE: "Feed", STORIES: "Stories" } as const;

const opcoes: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" };
const esteAno = new Intl.DateTimeFormat("pt-BR", opcoes);
const comAno = new Intl.DateTimeFormat("pt-BR", { ...opcoes, year: "numeric" });
const anoDe = new Intl.DateTimeFormat("pt-BR", { year: "numeric", timeZone: "America/Sao_Paulo" });
/** O ano só entra quando não é o atual. */
const quando = {
  format: (d: Date) => (Number.isNaN(d.getTime()) ? "data inválida" : (anoDe.format(d) === anoDe.format(Date.now()) ? esteAno : comAno).format(d)),
};

function pergunta(p: ParteAprovacao) {
  const midia = p.input?.media_type ? MIDIA[p.input.media_type] : "";
  const peca = p.input?.peca_pronta_id ? " a peça pronta" : "";
  if (p.type === "tool-publicar_agora") return { titulo: peca ? "Publicar a peça pronta agora?" : "Publicar agora no Instagram?", detalhe: `${midia}. Sai na hora, sem volta.` };
  // Enquanto a entrada chega pelo stream, a data ainda está pela metade e não vira Date válida.
  const data = new Date(p.input && "publish_at" in p.input ? (p.input.publish_at ?? "") : "");
  const titulo = peca ? "Agendar a peça pronta?" : "Agendar a publicação?";
  if (Number.isNaN(data.getTime())) return { titulo, detalhe: `${midia}.` };
  const passou = data.getTime() < Date.now() ? " Esse horário já passou. Recuse e peça outro." : "";
  return { titulo, detalhe: `${midia}, ${quando.format(data)}.${passou}` };
}

function desfecho(p: ParteAprovacao): { texto: string; erro?: boolean } | null {
  switch (p.state) {
    case "approval-responded":
      return p.approval.approved
        ? { texto: p.type === "tool-publicar_agora" ? "Aprovado. Publicando" : "Aprovado. Agendando" }
        : { texto: "Recusado." };
    case "output-denied":
      return { texto: "Recusado." };
    case "output-error":
      return { texto: p.errorText, erro: true };
    case "output-available": {
      const o = p.output;
      if (!o.ok) return { texto: o.motivo, erro: true };
      return { texto: "publishAt" in o ? `Agendado para ${quando.format(new Date(o.publishAt))}.` : "Publicado no Instagram." };
    }
    default:
      return null;
  }
}

/**
 * O que precisa terminar antes de uma aprovação sair, por id do pedido: hoje, guardar a legenda revisada da
 * peça pronta. Devolve false quando não deu, e a aprovação não sai.
 */
export const antesDeAprovar = new Map<string, () => Promise<boolean>>();

/** Os pedidos de aprovação ainda sem resposta, nem do servidor nem desta tela. */
export function aprovacoesPendentes(mensagens: readonly Mensagem[], respondidas: ReadonlySet<string>): string[] {
  return mensagens.flatMap((m) =>
    m.parts.flatMap((p) => (ehAprovacao(p) && p.state === "approval-requested" && !respondidas.has(p.approval.id) ? [p.approval.id] : [])),
  );
}

/**
 * Pedido de aprovação de publicar_agora e agendar_publicacao. A conversa guarda quem já foi
 * respondido, então clique, A e R valem uma vez só. O cartão é focável e as teclas A e R
 * agem nele; as dicas aparecem com o foco dentro.
 */
export function CartaoAprovacao({ parte, respondida, responder }: { parte: ParteAprovacao; respondida: boolean; responder: (id: string, aprovado: boolean) => void }) {
  const { titulo, detalhe } = pergunta(parte);
  const fim = desfecho(parte);
  const pendente = parte.state === "approval-requested";
  // Publicar agora não tem volta: o botão diz o que faz e ganha a cor de atenção.
  const agora = parte.type === "tool-publicar_agora";
  const secao = useRef<HTMLElement>(null);
  const pecaId = parte.input?.peca_pronta_id ?? null;
  const [peca] = useApi<PecaProntaDaApi>(pecaId && `/api/pecas-prontas/${pecaId}`);
  // null enquanto a pessoa não mexe: vale a legenda guardada na peça.
  const [legenda, setLegenda] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  /** A legenda revisada vai para a peça antes da aprovação; a tool publica o que está na peça. */
  async function guardarLegenda(): Promise<boolean> {
    const guardada = peca.estado === "pronto" ? (peca.dados.legenda ?? "") : null;
    if (!pecaId || legenda === null || legenda === guardada) return true;
    setSalvando(true);
    try {
      await apiPecasProntas.legenda(pecaId, legenda);
      return true;
    } catch (e) {
      mostrarAviso({ tipo: "erro", texto: `Não deu para guardar a legenda. Nada foi aprovado. ${(e as Error).message}` });
      return false;
    } finally {
      setSalvando(false);
    }
  }
  const guardarAtual = useRef(guardarLegenda);
  guardarAtual.current = guardarLegenda;
  // Clique e tecla A passam pelo responder da conversa, que consulta este registro antes de aprovar.
  const approvalId = pendente ? parte.approval.id : null;
  useEffect(() => {
    if (!approvalId || !pecaId) return;
    antesDeAprovar.set(approvalId, () => guardarAtual.current());
    return () => void antesDeAprovar.delete(approvalId);
  }, [approvalId, pecaId]);

  // O botão some ou fica desabilitado ao responder; o foco fica no cartão, que anuncia o desfecho.
  useEffect(() => {
    const foco = document.activeElement;
    if (respondida && (foco === document.body || secao.current?.contains(foco))) secao.current?.focus();
  }, [respondida]);

  return (
    <section
      ref={secao}
      aria-label={titulo}
      data-escopo="conversa"
      data-aprovacao={pendente ? parte.approval.id : undefined}
      tabIndex={pendente && !respondida ? 0 : -1}
      className="group/aprovacao rounded-cartao border border-linha bg-superficie px-4 py-3.5 text-sm/normal outline-offset-2 focus-visible:outline-2 focus-visible:outline-tinta"
    >
      <p className="font-medium">{titulo}</p>
      <p className="text-pretty text-tinta-2">{detalhe}</p>
      {pecaId && <PecaNoCartao carga={peca} editavel={pendente && !respondida && !salvando} legenda={legenda} mudar={setLegenda} />}
      {pendente ? (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            disabled={respondida}
            onClick={() => responder(parte.approval.id, false)}
            aria-keyshortcuts={ariaDe("recusar", ehMac)}
            className="pressiona flex h-9 cursor-pointer items-center gap-2 rounded-full bg-linha px-4 text-[13px] font-medium hover:bg-linha-forte disabled:cursor-default disabled:opacity-50"
          >
            {agora ? "Não publicar" : "Não agendar"}
            <span className="hidden group-focus-within/aprovacao:inline-flex">
              <Teclas atalho="recusar" />
            </span>
          </button>
          <button
            type="button"
            disabled={respondida || salvando}
            onClick={() => responder(parte.approval.id, true)}
            aria-keyshortcuts={ariaDe("aprovar", ehMac)}
            className={`pressiona flex h-9 cursor-pointer items-center gap-2 rounded-full px-4 text-[13px] font-medium text-sobre-tinta disabled:cursor-default disabled:opacity-50 ${
              agora ? "bg-esperando-texto" : "bg-tinta"
            }`}
          >
            {salvando ? "Guardando a legenda" : agora ? "Publicar agora" : "Agendar"}
            <span className="hidden group-focus-within/aprovacao:inline-flex">
              <Teclas atalho="aprovar" tom="escuro" />
            </span>
          </button>
        </div>
      ) : (
        fim && (
          <p role="status" className="mt-2 flex items-start gap-2">
            <IconeDaFase fase={fim.erro ? "falhou" : faseDa(parte)} />
            <span className={`min-w-0 [overflow-wrap:anywhere] ${fim.erro ? "text-erro" : COR_DO_ROTULO[faseDa(parte)]}`}>{fim.texto}</span>
          </p>
        )
      )}
    </section>
  );
}

/** A peça pronta que o cartão vai publicar: a imagem e a legenda, que a pessoa revisa antes de aprovar. */
function PecaNoCartao({
  carga,
  editavel,
  legenda,
  mudar,
}: {
  carga: ReturnType<typeof useApi<PecaProntaDaApi>>[0];
  editavel: boolean;
  legenda: string | null;
  mudar: (legenda: string) => void;
}) {
  if (carga.estado === "carregando") return <p className="mt-3 text-tinta-3">Carregando a peça…</p>;
  if (carga.estado === "erro") return <p className="mt-3 text-erro">Não deu para abrir a peça pronta. {carga.erro.message}</p>;
  const p = carga.dados;
  const texto = legenda ?? p.legenda ?? "";
  return (
    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
      <img src={p.url} alt={p.texto || p.tema} className="w-24 flex-none rounded-item object-contain outline-1 -outline-offset-1 outline-linha" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium [overflow-wrap:anywhere]">{p.tema}</p>
        {p.formato === "story" ? (
          <p className="text-tinta-3">Story sai sem legenda.</p>
        ) : editavel ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-tinta-3">Legenda, revise antes de aprovar</span>
            <textarea
              value={texto}
              onChange={(e) => mudar(e.target.value)}
              rows={6}
              maxLength={2200}
              className="w-full resize-y rounded-item border border-borda-campo bg-transparent px-3 py-2 text-base/normal sm:text-sm/normal"
            />
          </label>
        ) : (
          <p className="whitespace-pre-line text-pretty text-tinta-2 [overflow-wrap:anywhere]">{texto || "Sem legenda."}</p>
        )}
      </div>
    </div>
  );
}
