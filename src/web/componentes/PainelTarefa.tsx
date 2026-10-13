import type { UIMessage } from "ai";
import { useEffect, useRef } from "react";
import { useApi, useNomesDosBots } from "../api";
import { especialistaDa, type ParteDelegacao, type Tarefa } from "../tipos";
import { Avatar } from "./Avatar";
import { Falha } from "./Falha";
import { atividadeDe } from "./ia/atividade";
import { Pensando } from "./ia/Pensando";
import { Raciocinio } from "./ia/Raciocinio";
import { Markdown } from "./Markdown";
import { comArtes, Passos, trechosDe } from "./Passos";

const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });

/**
 * A conversa do especialista: texto, raciocínio, passos e as artes que as tools devolveram.
 * `aoVivo` é a mensagem que ainda está chegando; ela ganha o cursor. `noAr`: o especialista está rodando.
 */
function Transcricao({ mensagens, aoVivo, noAr }: { mensagens: readonly UIMessage[]; aoVivo: UIMessage | null; noAr: boolean }) {
  const pensando = noAr && atividadeDe(aoVivo, true).tipo === "pensando";
  return (
    <>
      {mensagens.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="max-w-[88%] self-end rounded-[18px] bg-ativo px-3.5 py-2 text-[13px] whitespace-pre-line text-tinta">
            {m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}
          </div>
        ) : (
          <div key={m.id} className="flex flex-col gap-3.5">
            {trechosDe(m.parts).map((t) => {
              if (t.tipo === "passos") return <Passos key={t.chave} passos={t.passos} extra={comArtes} />;
              const p = t.parte;
              if (p.type === "reasoning") return <Raciocinio key={t.chave} texto={p.text} ativo={m === aoVivo && p.state === "streaming"} />;
              if (p.type === "text")
                return p.text.trim() ? (
                  <Markdown key={t.chave} texto={p.text} digitando={m === aoVivo && p.state === "streaming"} className="gap-2.5 text-[13px]/relaxed" />
                ) : null;
              return null;
            })}
          </div>
        ),
      )}
      {pensando && <Pensando />}
    </>
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
  const nomes = useNomesDosBots();
  const nome = bot ? nomes[bot].nome : "especialista";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 px-4 py-3">
        {bot && <Avatar bot={bot} tamanho={30} estado={aoVivo ? "trabalhando" : "parado"} />}
        <span className="flex min-w-0 flex-col">
          <h2 className="font-semibold">Tarefa de {nome}</h2>
          <span className="text-xs text-tinta-3">
            {tarefa ? `Pedida por ${nomes.chefe.nome} às ${hora.format(tarefa.criadaEm)}` : `Pedida por ${nomes.chefe.nome}`}
          </span>
        </span>
        <button
          ref={fecharBotao}
          type="button"
          onClick={fechar}
          aria-label="Fechar tarefa"
          className="pressiona ml-auto grid size-10 flex-none cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-hover"
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M2 2l8 8M10 2l-8 8" />
          </svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain px-4 pt-2 pb-4">
        {carga.estado === "erro" && !aoVivo ? (
          <Falha texto="Não deu para abrir esta tarefa." erro={carga.erro} tentar={recarregar} className="text-[13px]" />
        ) : (
          <Transcricao mensagens={mensagens} aoVivo={aoVivo} noAr={status === "trabalhando"} />
        )}
        {tarefa?.status === "falhou" && tarefa.erro && <p className="text-[13px] text-erro">{tarefa.erro}</p>}
      </div>
    </div>
  );
}
