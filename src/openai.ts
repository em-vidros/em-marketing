import OpenAI from "openai";

export const MODELO_DE_TEXTO = "gpt-6-luna";

/** Sunburst, e não Flare: o Flare troca qualidade por velocidade, e a arte de marca precisa de texto nítido e da mesma cena entre o feed e o story. O preço por token é o mesmo. */
export const MODELO_DE_IMAGEM = "gpt-image-2.6-sunburst";

let cliente: OpenAI | null = null;

/** Lê OPENAI_API_KEY na primeira chamada, para o processo subir sem a chave. */
export const openai = () => (cliente ??= new OpenAI());
