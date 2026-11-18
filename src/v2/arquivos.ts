import { mkdirSync } from "node:fs";
import { join } from "node:path";

/** Onde as imagens das referências e as cenas ficam. Hoje é o disco local; na Vercel vira o Blob. */
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
