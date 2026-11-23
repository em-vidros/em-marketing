import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Brief } from "../art/pipeline";
import { definirHeadline, escreverLegenda } from ".";

const fetchOriginal = globalThis.fetch;
const chaveOriginal = process.env.OPENAI_API_KEY;
beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-teste-falsa";
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  process.env.OPENAI_API_KEY = chaveOriginal;
});

/** Um modelo de texto falso: devolve as respostas em ordem pelo /responses e guarda o que recebeu. Nada sai da máquina. */
function modeloFalso(...respostas: string[]) {
  const recebido: { instructions: string; input: string }[] = [];
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (!String(url).endsWith("/responses")) throw new Error(`o teste não deixa chamar ${String(url)}`);
    recebido.push(JSON.parse(String(init?.body)));
    const text = respostas[recebido.length - 1] ?? respostas.at(-1)!;
    const corpo = {
      id: `resp_${recebido.length}`,
      object: "response",
      status: "completed",
      output: [{ type: "message", id: "m", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }],
    };
    return new Response(JSON.stringify(corpo), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return recebido;
}

const legendaPara = (cta: string) => `Box em temperado 8 mm, pronta entrega.

Tamanhos padronizados.
Sem espera por beneficiamento.

${cta}

#EMVidros #VidroTemperado #Maranhão`;

const brief = (publico?: Brief["publico"]): Brief => ({ pilar: "PROVA", tema: "box em temperado 8 mm", precisaFotoReal: false, publico });

describe("legenda", () => {
  test("o prompt diz o público e a chamada dele", async () => {
    const recebido = modeloFalso(legendaPara("Procure uma vidraçaria parceira EM Vidros."));
    const { problemas } = await escreverLegenda(brief("consumidor"), "Box pronto para levar");
    expect(recebido[0]!.input).toContain("Público deste post: consumidor final");
    expect(recebido[0]!.input).toContain("Procure uma vidraçaria parceira EM Vidros.");
    expect(recebido[0]!.input).toContain('"publico":"consumidor"');
    expect(problemas.filter((p) => p.severidade === "erro")).toEqual([]);
  });

  test("o prompt do vidraceiro deixa a chamada ir direto à EM Vidros", async () => {
    const recebido = modeloFalso(legendaPara("Fale com a unidade mais próxima."));
    const { problemas } = await escreverLegenda(brief("vidraceiro"), "Box pronto para levar");
    expect(recebido[0]!.input).toContain("Público deste post: vidraceiro");
    expect(recebido[0]!.input).toContain("A chamada pode levar direto à EM Vidros");
    expect(recebido[0]!.input).not.toContain("Procure uma vidraçaria parceira");
    expect(problemas).toEqual([]);
  });

  test('"compre com a gente" num post para consumidor volta ao modelo para reescrever, e a versão certa fica', async () => {
    const recebido = modeloFalso(legendaPara("Compre com a gente."), legendaPara("Procure uma vidraçaria parceira EM Vidros."));
    const { legenda, problemas } = await escreverLegenda(brief("consumidor"), "Box pronto para levar");
    expect(recebido).toHaveLength(2);
    expect(recebido[1]!.input).toContain("§10.3 CTA por público");
    expect(legenda).toContain("Procure uma vidraçaria parceira EM Vidros.");
    expect(problemas).toEqual([]);
  });

  test('"compre com a gente" num post para vidraceiro é aceito de primeira', async () => {
    const recebido = modeloFalso(legendaPara("Compre com a gente."));
    const { problemas } = await escreverLegenda(brief("vidraceiro"), "Box pronto para levar");
    expect(recebido).toHaveLength(1);
    expect(problemas.some((p) => p.regra === "§10.3 CTA por público")).toBe(false);
  });

  test("brief antigo, sem público, escreve para o vidraceiro", async () => {
    const recebido = modeloFalso(legendaPara("Fale com a unidade mais próxima."));
    await escreverLegenda(brief(undefined), "Box pronto para levar");
    expect(recebido[0]!.input).toContain("Público deste post: vidraceiro");
  });

  test("pilar MARCA não pede chamada ao modelo, qualquer que seja o público", async () => {
    const recebido = modeloFalso("Trinta anos de EM Vidros.\n\nDesde 1995 no Maranhão.\n\n#EMVidros");
    await escreverLegenda({ ...brief("consumidor"), pilar: "MARCA" }, "30 anos");
    expect(recebido[0]!.input).toContain("SEM CTA");
    expect(recebido[0]!.input).not.toContain("Procure uma vidraçaria parceira");
  });
});

describe("headline", () => {
  test("o prompt diz o público e a regra da chamada", async () => {
    const recebido = modeloFalso('{"headline":"Box em temperado 8 mm","apoio":"Procure uma vidraçaria parceira EM Vidros."}');
    const r = await definirHeadline(brief("arquiteto"), "feed");
    expect(recebido[0]!.input).toContain("Público deste post: arquiteto");
    expect(recebido[0]!.input).toContain("Procure uma vidraçaria parceira EM Vidros.");
    expect(r.problemas).toEqual([]);
  });

  test("chamada direta no apoio de um post para consumidor volta ao modelo", async () => {
    const recebido = modeloFalso(
      '{"headline":"Box em temperado 8 mm","apoio":"Compre com a gente"}',
      '{"headline":"Box em temperado 8 mm","apoio":"Procure uma vidraçaria parceira EM Vidros."}',
    );
    const r = await definirHeadline(brief("consumidor"), "feed");
    expect(recebido).toHaveLength(2);
    expect(r.apoio).toBe("Procure uma vidraçaria parceira EM Vidros.");
    expect(r.problemas).toEqual([]);
  });
});
