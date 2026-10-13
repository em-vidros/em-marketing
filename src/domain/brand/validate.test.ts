import { expect, test, describe } from "bun:test";
import { validarLegenda, validarTextoDaArte, temErro } from "./validate";

const regras = (ps: { regra: string }[]) => ps.map((p) => p.regra);

describe("legenda aprovada", () => {
  // Exemplar do §10.4, pilar AUTORIDADE, com o bloco de hashtags do §11.5.
  const boa = `O temperado quebra em grãos. O comum, em lâminas.

Por isso a norma exige temperado em box, porta e guarda-corpo.
Nossa linha é certificada pelo INMETRO e pelo Instituto Falcão Bauer nas espessuras 6, 8 e 10 mm.

Confira a espessura certa para o seu projeto.

#EMVidros #VidroTemperado #SetorVidreiro #Maranhão`;

  test("não gera erro", () => {
    const ps = validarLegenda(boa, { pilar: "AUTORIDADE" });
    expect(ps.filter((p) => p.severidade === "erro")).toEqual([]);
  });

  test("INMETRO em caixa alta não é violação", () => {
    expect(regras(validarLegenda(boa))).not.toContain("§5.5 caixa alta");
  });
});

describe("legenda no tom antigo do voice.md", () => {
  // Escrita segundo o brand/voice.md que este commit remove: 🩵 de assinatura,
  // pergunta provocativa, 7 hashtags, urgência de varejo.
  const ruim = `Você sabia que o vidro temperado é 5x mais resistente? 🩵✨

Somos referência no mercado e trabalhamos com produtos de alta qualidade!
Venha conferir nossa linha completa de 10mm!

Fale com a unidade mais próxima e peça o orçamento pelo 0800 150 0103.

#vidros #EMVidros #qualidade #vidrosdequalidade #instagood #temperado #Imperatriz`;

  const ps = validarLegenda(ruim, { pilar: "AUTORIDADE" });

  test("pega a pergunta genérica", () => {
    expect(ps.some((p) => p.detalhe.includes("Você sabia"))).toBe(true);
  });
  test("pega 🩵 e ✨ da lista negra", () => {
    const negra = ps.filter((p) => p.regra === "§11.4 lista negra");
    expect(negra.length).toBe(2);
  });
  test("pega dois emojis seguidos e o emoji no gancho", () => {
    expect(ps.filter((p) => p.regra === "§11.2 emoji").length).toBeGreaterThanOrEqual(2);
  });
  test("pega o teto de 5 hashtags e a ordem de #EMVidros", () => {
    const tags = ps.filter((p) => p.regra === "§11.5 hashtag");
    expect(tags.some((p) => p.detalhe.includes("7 hashtags"))).toBe(true);
    expect(tags.some((p) => p.detalhe.includes("primeira"))).toBe(true);
    expect(tags.some((p) => p.detalhe.includes("#qualidade"))).toBe(true);
  });
  test("pega urgência de varejo e superlativo", () => {
    const lex = ps.filter((p) => p.regra === "§9.3 léxico proibido");
    expect(lex.some((p) => p.detalhe.includes("enha conferir"))).toBe(true);
    expect(lex.some((p) => p.detalhe.toLowerCase().includes("referência"))).toBe(true);
  });
  test("pega 10mm sem espaço", () => {
    expect(regras(ps)).toContain("§5.6 unidades");
  });
  test("pega mais de uma exclamação", () => {
    expect(ps.some((p) => p.detalhe.includes("exclamações"))).toBe(true);
  });
  test("pega dois CTAs", () => {
    expect(ps.some((p) => p.regra === "§10.3 CTA")).toBe(true);
  });
});

describe("regras pontuais", () => {
  const base = "Gancho curto e direto.\n\nCorpo.\n\n#EMVidros #VidroTemperado";

  test("MARCA não aceita CTA", () => {
    const ps = validarLegenda(`Onze anos de EM Vidros.\n\nDe uma fábrica na Raposa a seis unidades.\n\nFale com a unidade mais próxima.\n\n#EMVidros`, { pilar: "MARCA" });
    expect(ps.some((p) => p.regra === "§10.3 CTA" && p.severidade === "erro")).toBe(true);
  });

  test("MARCA sem CTA passa", () => {
    const ps = validarLegenda(`Onze anos de EM Vidros.\n\nDe uma fábrica na Raposa a seis unidades no Maranhão, Pará e Piauí.\n\n#EMVidros #Maranhão`, { pilar: "MARCA" });
    expect(temErro(ps)).toBe(false);
  });

  test("hashtag no meio do texto é erro", () => {
    const ps = validarLegenda(`Gancho curto.\n\nCorpo com #EMVidros no meio.\n\n#EMVidros #Maranhão`);
    expect(ps.some((p) => p.detalhe.includes("dentro do texto"))).toBe(true);
  });

  test("grafia errada do nome", () => {
    expect(validarLegenda(base.replace("Gancho", "EM VIDROS")).some((p) => p.regra === "§2.1 grafia do nome")).toBe(true);
  });

  test("tagline em minúsculas é erro", () => {
    expect(validarTextoDaArte("imagine em vidro").some((p) => p.regra === "§2.2 grafia da tagline")).toBe(true);
  });

  test("caixa alta para ênfase", () => {
    const ps = validarLegenda(`PROMOÇÃO IMPERDÍVEL SÓ HOJE AGORA.\n\nCorpo.\n\n#EMVidros`);
    expect(regras(ps)).toContain("§5.5 caixa alta");
  });

  test("emoji da lista branca passa", () => {
    const ps = validarLegenda(`Box pronto para levar hoje.\n\nEm seis unidades. 📍 Imperatriz.\n\n#EMVidros #Imperatriz`);
    expect(ps.filter((p) => p.regra.startsWith("§11"))).toEqual([]);
  });

  test("falta de #EMVidros é erro", () => {
    expect(validarLegenda("Gancho.\n\nCorpo.\n\n#VidroTemperado").some((p) => p.detalhe.includes("falta #EMVidros"))).toBe(true);
  });
});

describe("texto da arte", () => {
  test("emoji na arte é erro", () => {
    expect(validarTextoDaArte("Dia do Vidraceiro 🎉").some((p) => p.regra === "§11.2 emoji")).toBe(true);
  });
  test("headline limpo passa", () => {
    expect(temErro(validarTextoDaArte("18 de maio. Dia do Vidraceiro.", "Quem transforma projeto em obra."))).toBe(false);
  });
  test("espessura sem espaço é erro", () => {
    expect(validarTextoDaArte("Temperado 8mm certificado").some((p) => p.regra === "§5.6 unidades")).toBe(true);
  });
});
