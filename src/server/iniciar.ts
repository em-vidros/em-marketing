import { criarTabelas } from "../db";
import { arquivosNaNuvem, arquivosNoDisco } from "../v2/arquivos";
import { abrirBanco } from "../v2/banco";
import { chaveDe } from "../domain/chaves";
import { iaDaOpenAI } from "../v2/ia";

/**
 * O boot que o servidor local e a função da Vercel compartilham: abre o banco, cria as tabelas
 * que faltam e monta o estúdio. Nada pode usar o banco antes disto terminar.
 */
export async function iniciar() {
  const segredo = process.env.BETTER_AUTH_SECRET;
  if (!segredo) throw new Error("BETTER_AUTH_SECRET não definido.");
  // Chave própria para assinar aprovações, derivada do segredo do better-auth.
  const segredoAprovacao = new Bun.CryptoHasher("sha256", segredo).update("aprovacao-de-tools").digest("hex");

  const banco = await abrirBanco({ url: process.env.DATABASE_URL, dir: "data/pglite" });
  await criarTabelas();
  const estudio = {
    banco,
    ia: iaDaOpenAI(() => chaveDe("openai")),
    arquivos: process.env.BLOB_READ_WRITE_TOKEN ? arquivosNaNuvem() : arquivosNoDisco("data/arquivos"),
  };
  return { estudio, segredoAprovacao };
}
