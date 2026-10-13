import { useRef, useState } from "react";
import { faseDa, type ParteAprovacao } from "../tipos";
import { COR_DO_ROTULO, IconeDaFase } from "./ia/LinhaFerramenta";

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

/** Pedido de aprovação de publicar_agora e agendar_publicacao. Um clique só vale; o segundo é ignorado. */
export function CartaoAprovacao({ parte, responder }: { parte: ParteAprovacao; responder: (id: string, aprovado: boolean) => void }) {
  const [respondeu, setRespondeu] = useState(false);
  const enviado = useRef(false);
  const { titulo, detalhe } = pergunta(parte);
  const fim = desfecho(parte);

  function decidir(aprovado: boolean) {
    if (enviado.current || parte.state !== "approval-requested") return;
    enviado.current = true;
    setRespondeu(true);
    responder(parte.approval.id, aprovado);
  }

  return (
    <section aria-label={titulo} className="rounded-cartao border border-linha bg-superficie px-4 py-3.5 text-sm/normal">
      <p className="font-medium">{titulo}</p>
      <p className="text-tinta-2">{detalhe}</p>
      {parte.state === "approval-requested" ? (
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            disabled={respondeu}
            onClick={() => decidir(false)}
            className="pressiona h-9 cursor-pointer rounded-full bg-linha px-4 text-[13px] font-medium transition-colors duration-150 hover:bg-linha-forte disabled:cursor-default disabled:opacity-50"
          >
            Recusar
          </button>
          <button
            type="button"
            disabled={respondeu}
            onClick={() => decidir(true)}
            className="pressiona h-9 cursor-pointer rounded-full bg-tinta px-4 text-[13px] font-medium text-sobre-tinta disabled:cursor-default disabled:opacity-50"
          >
            Aprovar
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
