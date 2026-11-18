import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { get, put } from "@vercel/blob";

/** Onde as imagens das referências e as cenas ficam: o disco local, ou o Blob na Vercel. A chave é a mesma nos dois. */
export interface Arquivos {
  salvar(bytes: Uint8Array, extensao: Extensao): Promise<string>;
  ler(chave: string): Promise<Uint8Array<ArrayBuffer> | null>;
}

export const EXTENSOES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export type Extensao = (typeof EXTENSOES)[keyof typeof EXTENSOES];

export const TIPO_DA_EXTENSAO: Record<Extensao, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

const CHAVE = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;
export const ehChave = (s: string) => CHAVE.test(s);

export function arquivosNoDisco(dir: string): Arquivos {
  mkdirSync(dir, { recursive: true });
  return {
    async salvar(bytes, extensao) {
      const chave = `${crypto.randomUUID()}.${extensao}`;
      await Bun.write(join(dir, chave), bytes);
      return chave;
    },
    async ler(chave) {
      const arquivo = Bun.file(join(dir, chave));
      return ehChave(chave) && (await arquivo.exists()) ? new Uint8Array(await arquivo.arrayBuffer()) : null;
    },
  };
}

/**
 * No Blob, cada arquivo fica em `arquivos/<chave>`, sem sufixo aleatório: a chave guardada no banco basta
 * para achar o arquivo, e /api/arquivos/:chave continua atrás da sessão.
 */
export function arquivosNaNuvem(): Arquivos {
  return {
    async salvar(bytes, extensao) {
      const chave = `${crypto.randomUUID()}.${extensao}`;
      await put(`arquivos/${chave}`, Buffer.from(bytes), { access: "public", contentType: TIPO_DA_EXTENSAO[extensao], addRandomSuffix: false });
      return chave;
    },
    async ler(chave) {
      if (!ehChave(chave)) return null;
      const r = await get(`arquivos/${chave}`, { access: "public" });
      return r?.statusCode === 200 ? new Uint8Array(await new Response(r.stream).arrayBuffer()) : null;
    },
  };
}
