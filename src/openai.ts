import OpenAI from "openai";
import { chaveDe } from "./domain/chaves";
import { fetchQueConta } from "./domain/uso";

export const MODELO_DE_TEXTO = "gpt-6-luna";

/** Sunburst, e não Flare: o Flare troca qualidade por velocidade, e a arte de marca precisa de texto nítido e da mesma cena entre o feed e o story. O preço por token é o mesmo. */
export const MODELO_DE_IMAGEM = "gpt-image-2.6-sunburst";

/** Um cliente por chamada, com a chave que a equipe conectou ou a do servidor. */
export const openai = async () =>
  new OpenAI({ apiKey: (await chaveDe("openai")) ?? "", fetch: fetchQueConta("Post: headline, legenda e arte", MODELO_DE_IMAGEM) });
