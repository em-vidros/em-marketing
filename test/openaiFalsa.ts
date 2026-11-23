import { spyOn } from "bun:test";
import sharp from "sharp";

/** O tipo de cada chamada que o fluxo de post faz à OpenAI, pelo corpo do pedido. */
export type Chamada = "brief" | "headline" | "legenda" | "leitura" | "imagem";

/** Uma resposta da Responses API com só um texto. */
const resposta = (texto: string) => ({
  id: `resp_${crypto.randomUUID()}`,
  object: "response",
  status: "completed",
  output: [{ id: "msg_teste", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: texto, annotations: [] }] }],
  usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
});

export const BRIEF_FALSO = {
  pilar: "AUTORIDADE",
  tema: "vidro temperado x comum",
  angulo: "quebra segura",
  data: null,
  publico: null,
  precisa_foto_real: false,
  formato: "feed",
  direcao: null,
  alternativa_tipografica: null,
};

export const HEADLINE_FALSA = "O temperado quebra em grãos";
export const LEGENDA_FALSA = "O temperado quebra em grãos.\n\nÉ cinco vezes mais resistente.\nNão corta quem está perto.\n\nPeça o orçamento pelo direct.\n\n#EMVidros #vidrotemperado";

export interface OpcoesDaFalsa {
  brief?: object;
  /** Espera de cada chamada, em ms. `imagem` recebe a ordem do pedido, para as artes terminarem em tempos diferentes. */
  espera?: Partial<Record<Chamada, number | ((n: number) => number)>>;
}

/**
 * A OpenAI falsa do fluxo de post: responde brief, headline, legenda, leitura do texto da arte e imagem, conta cada
 * chamada e guarda o corpo. O cliente da OpenAI recusa chave vazia, então a chave é falsa; um pedido que não é do
 * fluxo falha o teste em vez de sair para a rede.
 */
export async function openaiFalsa({ brief = BRIEF_FALSO, espera = {} }: OpcoesDaFalsa = {}) {
  const cena = (await sharp({ create: { width: 1088, height: 1360, channels: 3, background: "#2F646A" } }).png().toBuffer()).toString("base64");
  const original = globalThis.fetch;
  const chave = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "sk-teste-nunca-chega-na-openai";
  const chamadas: { tipo: Chamada; corpo: { instructions?: string; input?: unknown; prompt_cache_key?: string } }[] = [];
  const esperar = async (tipo: Chamada) => {
    const n = chamadas.filter((c) => c.tipo === tipo).length;
    const e = espera[tipo];
    const ms = typeof e === "function" ? e(n) : (e ?? 0);
    if (ms) await Bun.sleep(ms);
  };

  const rede = spyOn(globalThis, "fetch").mockImplementation((async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(entrada instanceof Request ? entrada.url : entrada);
    if (url.hostname !== "api.openai.com") return original(entrada, init);
    if (url.pathname.startsWith("/v1/images/")) {
      chamadas.push({ tipo: "imagem", corpo: {} });
      await esperar("imagem");
      return Response.json({ data: [{ b64_json: cena }] });
    }
    if (url.pathname !== "/v1/responses") throw new Error(`O teste tentou chamar a OpenAI de verdade: ${url.pathname}`);
    const corpo = JSON.parse(String(init?.body));
    const formato = corpo.text?.format?.name;
    const entradaTexto = typeof corpo.input === "string" ? corpo.input : "";
    const tipo: Chamada | null =
      formato === "texto_lido" ? "leitura" : formato === "brief" ? "brief" : entradaTexto.includes("DENTRO da arte") ? "headline" : entradaTexto.includes("Escreva a legenda") ? "legenda" : null;
    if (!tipo) throw new Error(`O teste tentou chamar a OpenAI de verdade: ${entradaTexto.slice(0, 80)}`);
    chamadas.push({ tipo, corpo });
    await esperar(tipo);
    const texto = {
      leitura: JSON.stringify({ textos: [HEADLINE_FALSA] }),
      brief: JSON.stringify(brief),
      headline: JSON.stringify({ headline: HEADLINE_FALSA, apoio: "" }),
      legenda: LEGENDA_FALSA,
      imagem: "",
    }[tipo];
    return Response.json(resposta(texto));
  }) as typeof fetch);

  return {
    chamadas,
    contar: (tipo: Chamada) => chamadas.filter((c) => c.tipo === tipo).length,
    restaurar() {
      rede.mockRestore();
      if (chave === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = chave;
    },
  };
}
