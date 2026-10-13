import { useEffect, useRef } from "react";
import { ariaDe, ehMac } from "../teclado/atalhos";
import { ehAprovacao, faseDa, type Mensagem, type ParteAprovacao } from "../tipos";
import { COR_DO_ROTULO, IconeDaFase } from "./ia/LinhaFerramenta";
import { Teclas } from "./menu/Teclas";

const MIDIA = { IMAGE: "Feed", STORIES: "Stories" } as const;

const quando = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

function pergunta(p: ParteAprovacao) {
  const midia = p.input?.media_type ? MIDIA[p.input.media_type] : "";
  if (p.type === "tool-publicar_agora") return { titulo: "Publicar agora no Instagram?", detalhe: `${midia}. Sai na hora, sem volta.` };
  // Enquanto a entrada chega pelo stream, a data ainda está pela metade e não vira Date válida.
  const data = new Date(p.input && "publish_at" in p.input ? (p.input.publish_at ?? "") : "");
  return { titulo: "Agendar a publicação?", detalhe: Number.isNaN(data.getTime()) ? `${midia}.` : `${midia}, ${quando.format(data)}.` };
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
  const secao = useRef<HTMLElement>(null);

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
      <p className="text-tinta-2">{detalhe}</p>
      {pendente ? (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            disabled={respondida}
            onClick={() => responder(parte.approval.id, false)}
            aria-keyshortcuts={ariaDe("recusar", ehMac)}
            className="pressiona flex h-9 cursor-pointer items-center gap-2 rounded-full bg-linha px-4 text-[13px] font-medium transition-colors duration-150 hover:bg-linha-forte disabled:cursor-default disabled:opacity-50"
          >
            Recusar
            <span className="hidden group-focus-within/aprovacao:inline-flex">
              <Teclas atalho="recusar" />
            </span>
          </button>
          <button
            type="button"
            disabled={respondida}
            onClick={() => responder(parte.approval.id, true)}
            aria-keyshortcuts={ariaDe("aprovar", ehMac)}
            className="pressiona flex h-9 cursor-pointer items-center gap-2 rounded-full bg-tinta px-4 text-[13px] font-medium text-sobre-tinta disabled:cursor-default disabled:opacity-50"
          >
            Aprovar
            <span className="hidden group-focus-within/aprovacao:inline-flex">
              <Teclas atalho="aprovar" tom="escuro" />
            </span>
          </button>
        </div>
      ) : (
        fim && (
          <p role="status" className="mt-2 flex items-center gap-2">
            <IconeDaFase fase={fim.erro ? "falhou" : faseDa(parte)} />
            <span className={fim.erro ? "text-erro" : COR_DO_ROTULO[faseDa(parte)]}>{fim.texto}</span>
          </p>
        )
      )}
    </section>
  );
}
