import type { Camada } from "../../../v2/camadas";

export const TIPO = { texto: "Texto", logo: "Logo", imagem: "Imagem", forma: "Faixa" } as const;

export const descricaoDa = (c: Camada) =>
  c.tipo === "texto" ? c.texto : c.tipo === "logo" ? (c.variante === "cor" ? "Logo colorido" : "Logo branco") : c.tipo === "imagem" ? "Imagem enviada" : c.cor;
