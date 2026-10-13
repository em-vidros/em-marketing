// Copia os arquivos oficiais da pasta de logos da EM Vidros para brand/assets.
// O repositório guarda a cópia porque o container de produção não enxerga a pasta local.
//   bun scripts/sync-assets.ts          copia o que mudou
//   bun scripts/sync-assets.ts --check  só compara; sai com 1 se algo divergir
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const raiz = join(import.meta.dir, "../brand/assets");
const manifesto = JSON.parse(readFileSync(join(raiz, "fontes.json"), "utf8")) as {
  pasta: string;
  arquivos: Record<string, string>;
};
const pasta = process.env.EM_LOGOS_DIR ?? manifesto.pasta;
const soChecar = process.argv.includes("--check");

if (!existsSync(pasta)) {
  console.error(`Pasta de logos não encontrada: ${pasta}. Defina EM_LOGOS_DIR.`);
  process.exit(1);
}

const hash = (p: string) => new Bun.CryptoHasher("sha256").update(readFileSync(p)).digest("hex");

let divergentes = 0;
for (const [destino, origem] of Object.entries(manifesto.arquivos)) {
  const de = join(pasta, origem);
  const para = join(raiz, destino);
  if (!existsSync(de)) {
    console.error(`falta na pasta de logos: ${origem}`);
    divergentes++;
    continue;
  }
  if (existsSync(para) && hash(de) === hash(para)) continue;
  divergentes++;
  if (soChecar) {
    console.log(`diferente: ${destino}`);
    continue;
  }
  mkdirSync(dirname(para), { recursive: true });
  copyFileSync(de, para);
  console.log(`copiado: ${destino}`);
}

if (soChecar && divergentes) process.exit(1);
console.log(divergentes ? `${divergentes} arquivo(s) atualizados` : "brand/assets igual à pasta de logos");
