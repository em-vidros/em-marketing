import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { put } from "@vercel/blob";

/**
 * Onde moram os arquivos gerados (artes, fotos, JPEGs da fila). Com BLOB_READ_WRITE_TOKEN (Vercel),
 * vão para o Blob público e o caminho guardado no banco é a URL https. Sem ele, ficam em `data/`
 * e o caminho é o do disco. Quem lê não precisa saber qual dos dois: usa `lerArquivo`.
 */
const naNuvem = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

export const ehUrl = (caminho: string) => /^https?:\/\//.test(caminho);

/** Grava `bytes` em `pasta/nome` e devolve o caminho a guardar no banco. Gravar de novo no mesmo nome troca o conteúdo. */
export async function gravarArquivo(pasta: string, nome: string, bytes: Uint8Array, tipo: string): Promise<string> {
  if (naNuvem()) {
    const { url } = await put(`${pasta}/${nome}`, Buffer.from(bytes), { access: "public", contentType: tipo, addRandomSuffix: true });
    return url;
  }
  const caminho = join("data", pasta, nome);
  await mkdir(dirname(caminho), { recursive: true });
  await Bun.write(caminho, bytes);
  return caminho;
}

export async function lerArquivo(caminho: string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (ehUrl(caminho)) {
    const r = await fetch(caminho);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  }
  const arquivo = Bun.file(caminho);
  return (await arquivo.exists()) ? new Uint8Array(await arquivo.arrayBuffer()) : null;
}
