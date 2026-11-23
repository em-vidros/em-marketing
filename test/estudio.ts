import sharp from "sharp";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EstudioDaFila } from "../src/agent/fila";
import { arquivosNoDisco } from "../src/v2/arquivos";
import { banco } from "../src/v2/banco";
import { FORMATOS, type Plano } from "../src/v2/camadas";
import type { Ia } from "../src/v2/ia";

/** O estúdio que as rotas pedem: o Postgres do preload e arquivos numa pasta temporária, apagada na saída. */
export function estudioDeTeste(): EstudioDaFila {
  const dir = mkdtempSync(join(tmpdir(), "em-marketing-estudio-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  return { banco: banco(), arquivos: arquivosNoDisco(join(dir, "arquivos")) };
}

/**
 * A IA do estúdio sem rede: o plano e a cena saem fixos, e as chamadas ficam anotadas para o teste conferir.
 * Nunca chama a OpenAI. As leituras de imagem falham, para um teste não depender delas sem querer.
 */
export function iaDeTeste(plano: Partial<Plano> = {}): Ia & { planos: string[]; cenas: string[] } {
  const planos: string[] = [];
  const cenas: string[] = [];
  const nao = () => Promise.reject(new Error("A IA de teste não faz isso."));
  return {
    planos,
    cenas,
    lerReferencia: nao,
    lerElementos: nao,
    lerPecaPronta: nao,
    apagarAreas: nao,
    planejarArte: async (pedido) => {
      planos.push(pedido);
      return { cena: "flat matte pastel glass shapes", titulo: "Título do modelo", apoio: "Apoio do modelo", display: false, fundoEscuro: false, ...plano };
    },
    gerarCena: async (prompt, formato) => {
      cenas.push(prompt);
      const { largura, altura } = FORMATOS[formato];
      return sharp({ create: { width: largura, height: altura, channels: 3, background: "#E4E1D8" } }).jpeg().toBuffer();
    },
  };
}
