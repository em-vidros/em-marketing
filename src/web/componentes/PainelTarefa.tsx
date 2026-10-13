import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";
import { useApi } from "../api";
import { BOTS } from "../bots";
import { especialistaDa, imagensEm, passosDe, type ParteDelegacao, type Tarefa } from "../tipos";
import { Avatar } from "./Avatar";
import { Markdown } from "./Markdown";
import { Passos } from "./Passos";

const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Uma mensagem do especialista: texto, passos e as artes que as tools devolveram. */
function Transcricao({ mensagens }: { mensagens: readonly UIMessage[] }) {
  return mensagens.map((m) =>
    m.role === "user" ? (
      <div key={m.id} className="max-w-[88%] self-end rounded-[18px] bg-ativo px-3.5 py-2 text-[13px] whitespace-pre-line text-[#3a3836]">
        {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
      </div>
    ) : (
      <div key={m.id} className="flex flex-col gap-3.5">
        {m.parts.map((p, i) => {
          if (p.type === "text") return p.text.trim() ? <Markdown key={i} texto={p.text} className="gap-2.5 text-[13px]/relaxed" /> : null;
          const [passo] = passosDe({ ...m, parts: [p] });
          if (!passo) return null;
          const imagens = passo.estado === "feito" ? imagensEm(passo.saida) : [];
          return (
            <div key={i} className="flex flex-col gap-2 text-[13px]">
              <Passos passos={[passo]} />
              {imagens.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {imagens.map((src, n) => (
                    <a
                      key={src}
                      href={src}
                      target="_blank"
                      rel="noreferrer"
                      className="block overflow-hidden rounded-item outline-1 -outline-offset-1 outline-linha"
                    >
                      <img src={src} alt={`Arte ${n + 1}`} loading="lazy" className="aspect-[4/5] w-full bg-ativo object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    ),
  );
}

/**
 * O trabalho de um especialista. Ao vivo, a transcrição vem da prévia da tool no stream do
 * Chefe; depois que a tarefa termina (ou depois de recarregar a página), de /api/tarefas/:id.
 */
export function PainelTarefa({ tarefaId, parte, fechar }: { tarefaId: string; parte: ParteDelegacao | undefined; fechar: () => void }) {
  const status = parte?.state === "output-available" ? parte.output.status : undefined;
  const [carga, recarregar] = useApi<Tarefa>(`/api/tarefas/${tarefaId}`);
  useEffect(recarregar, [status, recarregar]);
  const tarefa = carga.estado === "pronto" ? carga.dados : null;
  const bot = parte ? especialistaDa(parte) : tarefa?.botId === "chefe" ? null : tarefa?.botId;
  const fecharBotao = useRef<HTMLButtonElement>(null);

  useEffect(() => fecharBotao.current?.focus(), [tarefaId]);

  const aoVivo = parte?.state === "output-available" && parte.output.status === "trabalhando" ? parte.output.mensagem : null;
  const pedido: UIMessage | null = parte?.input?.pedido
    ? { id: `${tarefaId}-pedido`, role: "user", parts: [{ type: "text", text: parte.input.pedido }] }
    : null;
  const mensagens = aoVivo && pedido ? [pedido, aoVivo] : (tarefa?.mensagens ?? (pedido ? [pedido] : []));
  const nome = bot ? BOTS[bot].nome : "especialista";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-3">
        {bot && <Avatar bot={bot} tamanho={30} estado={aoVivo ? "trabalhando" : "parado"} />}
        <span className="flex min-w-0 flex-col">
          <h2 className="font-semibold">Tarefa do {nome}</h2>
          <span className="text-xs text-tinta-3">
            {tarefa ? `Pedida pelo Chefe às ${hora.format(tarefa.criadaEm)}` : "Pedida pelo Chefe"}
          </span>
        </span>
        <button
          ref={fecharBotao}
          type="button"
          onClick={fechar}
          aria-label="Fechar tarefa"
          className="pressiona ml-auto grid size-10 flex-none cursor-pointer place-items-center rounded-full text-tinta-2 transition-colors duration-150 hover:bg-hover"
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain px-4 pt-2 pb-4">
        {carga.estado === "erro" && !aoVivo ? (
          <p className="text-[13px] text-tinta-2">Não deu para abrir esta tarefa. {carga.erro.message}</p>
        ) : (
          <Transcricao mensagens={mensagens} />
        )}
        {tarefa?.status === "falhou" && tarefa.erro && <p className="text-[13px] text-erro">{tarefa.erro}</p>}
      </div>
    </div>
  );
}
