import { useEffect, useId, useRef, useState } from "react";
import type { PedidoDeNovoBot as Pedido } from "../../agent/equipe";
import type { Modelo } from "../../agent/models";
import { useApi } from "../api";
import { CORES, FORMAS, recarregarBots, useEquipe, visualCriado, type Forma } from "../bots";
import { Avatar } from "../componentes/Avatar";
import { BotaoMenu } from "../componentes/BotaoMenu";
import { Cartao, Descricao, estiloCampo, Linha, Problema, SeletorDeModelo, Setor, TextoLongo } from "../componentes/bot/campos";
import { enviar } from "../componentes/bot/enviar";
import { LIMITE, type DetalheBot } from "../componentes/bot/formulario";
import { navegar } from "../rota";

const NOME_DA_COR: Record<(typeof CORES)[number], string> = {
  "#0a0a0a": "Preto",
  "#1AAE9F": "Verde-água",
  "#9558FF": "Roxo",
  "#1689FF": "Azul",
  "#FF9500": "Laranja",
  "#FF2D95": "Rosa",
  "#E5484D": "Vermelho",
  "#30A46C": "Verde",
  "#F5B400": "Amarelo",
  "#6E56CF": "Violeta",
};

type Campo = "nome" | "descricao" | "setor" | "prompt";

const conta = (n: number) => n.toLocaleString("pt-BR");

/** As mesmas regras de POST /api/bots, com o texto que a pessoa precisa para corrigir. */
function problemasDe(p: Pedido): Partial<Record<Campo, string>> {
  const problemas: Partial<Record<Campo, string>> = {};
  const rotulos: Record<Campo, string> = { nome: "um nome", descricao: "uma descrição", setor: "o setor", prompt: "o prompt" };
  for (const campo of ["nome", "descricao", "setor", "prompt"] as const) {
    const n = p[campo].trim().length;
    if (n === 0) problemas[campo] = `Escreva ${rotulos[campo]}.`;
    else if (n > LIMITE[campo]) problemas[campo] = `Use até ${conta(LIMITE[campo])} caracteres. Agora são ${conta(n)}.`;
  }
  return problemas;
}

/**
 * Criar um bot: qualquer pessoa da equipe pode. O que ela escreve aqui vira a primeira versão,
 * que é o padrão do bot; o resto (regras, memória) ela ajusta depois na aba Configuração.
 */
export default function NovoBot({ abrirMenu }: { abrirMenu: () => void }) {
  const ids = useId();
  const equipe = useEquipe();
  const setores = [...new Set(equipe.lista.map((b) => b.setor))];
  const [modelos, relerModelos] = useApi<Modelo[]>("/api/modelos");
  const [pedido, setPedido] = useState<Pedido>({
    nome: "",
    descricao: "",
    setor: "",
    forma: "squircle",
    cor: CORES[1],
    prompt: "",
    modelo: "openai:gpt-6-luna",
  });
  const [problemas, setProblemas] = useState<Partial<Record<Campo, string>>>({});
  const [envio, setEnvio] = useState<{ fase: "parado" | "enviando" } | { fase: "erro"; erro: string }>({ fase: "parado" });
  const campos = useRef<Partial<Record<Campo, HTMLElement | null>>>({});

  useEffect(() => {
    document.title = "Novo bot · EM Marketing";
  }, []);

  const mudar = <C extends keyof Pedido>(campo: C, valor: Pedido[C]) => {
    setPedido((p) => ({ ...p, [campo]: valor }));
    setProblemas(({ [campo as Campo]: _, ...resto }) => resto);
  };
  const campoDe = (c: Campo) => (el: HTMLElement | null) => {
    campos.current[c] = el;
  };
  const descrito = (c: Campo) => (problemas[c] ? `${ids}-${c}-erro` : undefined);

  const criar = async () => {
    const achados = problemasDe(pedido);
    setProblemas(achados);
    const primeiro = (["nome", "descricao", "setor", "prompt"] as const).find((c) => achados[c]);
    if (primeiro) return campos.current[primeiro]?.focus();
    setEnvio({ fase: "enviando" });
    try {
      const bot = await enviar<DetalheBot>("/api/bots", "POST", pedido);
      await recarregarBots();
      navegar(`/bots/${bot.id}`);
    } catch (e) {
      setEnvio({ fase: "erro", erro: (e as Error).message });
    }
  };

  return (
    <main id="conteudo" className="min-w-0 flex-1 overflow-y-auto">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void criar();
        }}
        className="mx-auto flex max-w-3xl flex-col gap-7 px-4 pt-3 pb-16 sm:px-6 md:pt-10"
      >
        <BotaoMenu abrir={abrirMenu} />
        <header className="flex items-center gap-4">
          <Avatar bot="" visual={visualCriado(pedido.forma, pedido.cor)} tamanho={56} anel="var(--color-fundo)" />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-2xl/tight font-semibold tracking-[-0.02em] text-balance [overflow-wrap:anywhere]">{pedido.nome.trim() || "Novo bot"}</h1>
            <p className="text-pretty text-tinta-2">Toda a equipe pode conversar com ele, mudar a configuração e apagar.</p>
          </div>
        </header>

        <Cartao>
          <Linha rotulo="Nome" para={`${ids}-nome`} ajuda="Aparece na barra lateral e no topo de cada conversa.">
            <input
              id={`${ids}-nome`}
              ref={campoDe("nome")}
              value={pedido.nome}
              onChange={(e) => mudar("nome", e.target.value)}
              autoComplete="off"
              maxLength={LIMITE.nome + 20}
              placeholder="Orçamentos"
              aria-invalid={problemas.nome ? true : undefined}
              aria-describedby={descrito("nome")}
              className={estiloCampo}
            />
            <Problema id={`${ids}-nome-erro`} texto={problemas.nome} />
          </Linha>
          <Linha rotulo="Descrição" para={`${ids}-descricao`} ajuda="Uma frase sobre o que ele faz. O bot lê essa frase para saber quais ferramentas usar, e ela aparece embaixo do nome.">
            <Descricao
              id={`${ids}-descricao`}
              campoRef={campoDe("descricao")}
              valor={pedido.descricao}
              aoMudar={(v) => mudar("descricao", v)}
              placeholder="Tira dúvidas de orçamento de vidro temperado."
              invalido={!!problemas.descricao}
              descrito={descrito("descricao")}
            />
            <Problema id={`${ids}-descricao-erro`} texto={problemas.descricao} />
          </Linha>
          <Linha rotulo="Setor" para={`${ids}-setor`} ajuda="Junta o bot com os outros do mesmo setor na barra lateral e diz a ele em que área trabalha.">
            <Setor
              id={`${ids}-setor`}
              valor={pedido.setor}
              setores={setores}
              aoMudar={(v) => mudar("setor", v)}
              campoRef={campoDe("setor")}
              invalido={!!problemas.setor}
              descrito={descrito("setor")}
            />
            <Problema id={`${ids}-setor-erro`} texto={problemas.setor} />
          </Linha>
          <Linha rotulo="Aparência" ajuda="A forma e a cor do avatar.">
            <div role="radiogroup" aria-label="Forma" className="grid w-fit grid-cols-4 gap-2">
              {(Object.keys(FORMAS) as Forma[]).map((forma) => (
                <label
                  key={forma}
                  className={`flex cursor-pointer flex-col items-center gap-1 rounded-[12px] border px-3 py-2 text-xs has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-tinta ${
                    pedido.forma === forma ? "border-tinta bg-fundo" : "border-linha-forte hover:bg-fundo"
                  }`}
                >
                  <input type="radio" name={`${ids}-forma`} checked={pedido.forma === forma} onChange={() => mudar("forma", forma)} className="sr-only" />
                  <Avatar bot="" visual={visualCriado(forma, pedido.cor)} tamanho={32} />
                  {FORMAS[forma].rotulo}
                </label>
              ))}
            </div>
            <div role="radiogroup" aria-label="Cor" className="flex flex-wrap gap-2 pt-1">
              {CORES.map((cor) => (
                <label
                  key={cor}
                  className="grid size-9 cursor-pointer place-items-center rounded-full has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-tinta"
                >
                  <input type="radio" name={`${ids}-cor`} checked={pedido.cor === cor} onChange={() => mudar("cor", cor)} aria-label={NOME_DA_COR[cor]} className="sr-only" />
                  <span
                    aria-hidden="true"
                    className="size-7 rounded-full"
                    style={{ background: cor, boxShadow: pedido.cor === cor ? `0 0 0 2px var(--color-superficie), 0 0 0 4px ${cor}` : undefined }}
                  />
                </label>
              ))}
            </div>
          </Linha>
          <Linha rotulo="Modelo" ajuda="A IA que escreve as respostas deste bot.">
            <SeletorDeModelo
              valor={pedido.modelo}
              salvo={pedido.modelo}
              modelos={modelos}
              relerModelos={relerModelos}
              aoMudar={(m) => mudar("modelo", m as Pedido["modelo"])}
            />
          </Linha>
        </Cartao>

        <Cartao titulo="O que o modelo recebe">
          <Linha
            rotulo="Prompt"
            para={`${ids}-prompt`}
            ajuda="Diga o que ele faz, em que ordem e o que evita. Escreva como se explicasse o trabalho a alguém que entrou na equipe hoje."
          >
            <TextoLongo
              id={`${ids}-prompt`}
              valor={pedido.prompt}
              limite={LIMITE.prompt}
              problema={problemas.prompt}
              aoMudar={(v) => mudar("prompt", v)}
              campoRef={campoDe("prompt")}
              placeholder="Você ajuda o comercial da EM Vidros a montar orçamentos. Pergunte medida, espessura e tipo de vidro antes de dar preço."
            />
          </Linha>
        </Cartao>
        <p className="-mt-4 px-1 text-[13px] text-pretty text-tinta-3">
          O bot escolhe as ferramentas sozinho, pela descrição e pelo setor. O brandbook da EM Vidros já vai junto no prompt. Depois de criar, a aba Configuração tem as regras, a memória e a opção de tirar o brandbook.
        </p>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {envio.fase === "erro" && (
            <p role="alert" className="mr-auto text-[13px] text-erro">
              Não deu para criar. {envio.erro}
            </p>
          )}
          <button
            type="submit"
            disabled={envio.fase === "enviando"}
            className="pressiona flex h-10 items-center rounded-full bg-tinta px-5 font-medium text-sobre-tinta disabled:cursor-progress disabled:opacity-70"
          >
            {envio.fase === "enviando" ? "Criando…" : "Criar bot"}
          </button>
        </div>
      </form>
    </main>
  );
}
