import { useId, useState } from "react";
import type { BotId } from "../../bots";
import { useApi } from "../../api";
import { Falha } from "../Falha";
import { dataCurta } from "../peca";
import { Cartao, TextoLongo } from "./campos";
import { enviar } from "./enviar";
import { LIMITE, type Memoria as MemoriaDoBot } from "./formulario";

const autoria = (m: MemoriaDoBot) => {
  if (m.atualizadaEm === null) return "Vazia. O bot também guarda notas aqui quando alguém pede para ele lembrar de algo.";
  const quem = m.autor === null ? "pelo próprio bot" : `por ${m.autor.split("@")[0]}`;
  return `Atualizada ${quem} em ${dataCurta.format(m.atualizadaEm)}.`;
};

/**
 * A memória do bot, a mesma para a equipe toda. Grava à parte do resto da config: não vira versão,
 * e o bot também escreve nela com a tool lembrar.
 */
export function Memoria({ id, inicial, aoGravar }: { id: BotId; inicial: MemoriaDoBot; aoGravar: (m: MemoriaDoBot) => void }) {
  const campo = useId();
  const [salva, setSalva] = useState(inicial);
  const [texto, setTexto] = useState(inicial.texto);
  const [estado, setEstado] = useState<{ fase: "parado" | "gravando" } | { fase: "erro"; erro: string }>({ fase: "parado" });
  const mudou = texto.trim() !== salva.texto;
  const longo = texto.trim().length > LIMITE.memoria;

  const gravar = async () => {
    setEstado({ fase: "gravando" });
    try {
      const nova = await enviar<MemoriaDoBot>(`/api/bots/${id}/memoria`, "PUT", { texto });
      setSalva(nova);
      setTexto(nova.texto);
      setEstado({ fase: "parado" });
      aoGravar(nova);
    } catch (e) {
      setEstado({ fase: "erro", erro: (e as Error).message });
    }
  };

  return (
    <Cartao titulo="Memória">
      <div className="flex flex-col gap-2.5 px-5 py-5">
        <label htmlFor={campo} className="text-[13px] text-pretty text-tinta-3">
          O que o bot precisa saber em toda conversa: preferências da equipe, clientes, decisões já tomadas. Entra no prompt depois das regras. {autoria(salva)}
        </label>
        <TextoLongo id={campo} valor={texto} limite={LIMITE.memoria} aoMudar={setTexto} baixo placeholder="2026-11-19: A Ana prefere legendas sem emoji." />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {estado.fase === "erro" && (
            <p role="alert" className="mr-auto text-[13px] text-erro">
              Não salvou. {estado.erro}
            </p>
          )}
          {mudou && (
            <button type="button" onClick={() => setTexto(salva.texto)} className="pressiona rounded-full px-3.5 py-1.5 font-medium text-tinta-2 hover:bg-hover">
              Descartar
            </button>
          )}
          <button
            type="button"
            onClick={() => void gravar()}
            disabled={!mudou || longo || estado.fase === "gravando"}
            className="pressiona rounded-full bg-tinta px-3.5 py-1.5 font-medium text-sobre-tinta disabled:cursor-not-allowed disabled:opacity-40"
          >
            {estado.fase === "gravando" ? "Salvando…" : "Salvar memória"}
          </button>
        </div>
      </div>
    </Cartao>
  );
}

/** O system prompt inteiro, como o modelo recebe. Só busca quando abre, e busca de novo quando a config ou a memória mudam. */
export function PromptFinal({ id, versao }: { id: BotId; versao: string }) {
  const [aberto, setAberto] = useState(false);
  // A versão na query troca o caminho, e o useApi busca de novo; o servidor a ignora.
  const [carga, recarregar] = useApi<{ texto: string }>(aberto ? `/api/bots/${id}/prompt?v=${encodeURIComponent(versao)}` : null);
  return (
    <details className="group px-1" onToggle={(e) => setAberto(e.currentTarget.open)}>
      <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 text-[13px] font-medium text-tinta-2 hover:text-tinta [&::-webkit-details-marker]:hidden">
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="transition-transform duration-200 ease-(--ease-saida) group-open:rotate-90"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        Ver o prompt final, como o modelo recebe
      </summary>
      <div className="flex flex-col gap-2 pt-1">
        <p className="text-[13px] text-pretty text-tinta-3">
          Prompt, regras, brandbook, a data de hoje e a memória, nesta ordem. O que está salvo agora; alterações não salvas não aparecem.
        </p>
        {carga.estado === "pronto" ? (
          <pre className="max-h-[60vh] overflow-auto overscroll-contain rounded-[10px] bg-fundo px-3 py-2.5 font-mono text-xs/relaxed whitespace-pre-wrap text-tinta-2">
            {carga.dados.texto}
          </pre>
        ) : carga.estado === "erro" ? (
          <Falha texto="Não deu para montar o prompt." erro={carga.erro} tentar={recarregar} />
        ) : (
          <p className="text-[13px] text-tinta-3">Montando o prompt…</p>
        )}
      </div>
    </details>
  );
}
