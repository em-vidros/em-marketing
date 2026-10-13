import { describe, expect, test } from "bun:test";
import { formulario, mudanca, problemasDe, sujo, type DetalheBot, type Formulario } from "./formulario";

const detalhe: DetalheBot = {
  id: "post",
  nome: "Post",
  descricao: "Brief, headline e artes",
  modelo: "google:gemini-3.6-flash",
  prompt: "Você monta o post.",
  sugestoes: [],
  versaoId: null,
  padrao: { nome: true, descricao: true, modelo: true, prompt: true },
  fixo: "Regras da marca",
  tools: [],
};

const aplicar = (...acoes: Parameters<typeof formulario>[1][]) =>
  acoes.reduce<Formulario>(formulario, formulario({ fase: "carregando" }, { tipo: "chegou", detalhe }));

const pronto = (f: Formulario) => {
  if (f.fase !== "pronto") throw new Error("esperava o formulário pronto");
  return f;
};

describe("formulário de config do bot", () => {
  test("fica sujo ao editar e limpo ao voltar ao valor salvo; o PUT leva só o campo mudado", () => {
    const editado = aplicar({ tipo: "editar", campo: "prompt", valor: "Você monta o post com calma." });
    expect(sujo(editado)).toBe(true);
    expect(mudanca(detalhe, pronto(editado).rascunho)).toEqual({ prompt: "Você monta o post com calma." });

    const devolvido = formulario(editado, { tipo: "editar", campo: "prompt", valor: detalhe.prompt });
    expect(sujo(devolvido)).toBe(false);
  });

  test("descartar volta ao salvo e recuperar devolve o rascunho jogado fora", () => {
    const descartado = aplicar({ tipo: "editar", campo: "nome", valor: "Postador" }, { tipo: "descartar" });
    expect(sujo(descartado)).toBe(false);
    expect(pronto(descartado).rascunho.nome).toBe("Post");

    const recuperado = formulario(descartado, { tipo: "recuperar" });
    expect(pronto(recuperado).rascunho.nome).toBe("Postador");
    expect(sujo(recuperado)).toBe(true);
  });

  test("salvar com campo inválido não envia e diz como corrigir", () => {
    const r = { ...detalhe, nome: "   ", prompt: "x".repeat(20_001) };
    const problemas = problemasDe(r);
    expect(problemas).toEqual({ nome: "Escreva um nome.", prompt: "Use até 20.000 caracteres. Agora são 20.001." });
    const f = pronto(aplicar({ tipo: "editar", campo: "nome", valor: "   " }, { tipo: "enviar", problemas }));
    expect(f.enviando).toBe(false);
    expect(f.problemas.nome).toBe("Escreva um nome.");
  });

  test("a resposta do servidor depois de salvar vira o novo salvo, e o erro do servidor fica até a próxima edição", () => {
    const enviando = aplicar({ tipo: "editar", campo: "modelo", valor: "anthropic:claude-opus-5-5" }, { tipo: "enviar", problemas: {} });
    expect(pronto(enviando).enviando).toBe(true);

    const falhou = formulario(enviando, { tipo: "falhou", erro: "O Claude Opus 5.5 não está disponível." });
    expect(pronto(falhou)).toMatchObject({ enviando: false, erro: "O Claude Opus 5.5 não está disponível." });
    expect(sujo(falhou)).toBe(true);

    const salvo = formulario(enviando, { tipo: "chegou", detalhe: { ...detalhe, modelo: "anthropic:claude-opus-5-5", versaoId: 7 } });
    expect(sujo(salvo)).toBe(false);
    expect(pronto(salvo).salvo.versaoId).toBe(7);
  });
});
