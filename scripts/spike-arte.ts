// Fase 1 (bloqueante): gera 3 variações reais do post "Dia do Vidraceiro 18/05"
// em Feed (1080×1350) e Stories (1080×1920) e valida os critérios da §3.4 do PRD.
//
// Uso: GEMINI_API_KEY=... bun scripts/spike-arte.ts [feed|stories|ambos]
//
// Usa buildPrompt/stylesFor do próprio pipeline em vez de reimplementá-los: um
// gate que testa uma cópia do código não testa o código.
import { mkdirSync, writeFileSync } from "node:fs";
import { generateArt, type Formato } from "../src/art/generate";
import { buildPrompt, stylesFor, type Brief } from "../src/art/pipeline";
import { validarTextoDaArte, formatarProblemas } from "../src/brand/validate";

// Exemplar do banco de legendas do §10.4, pilar MARCA.
const HEADLINE = "18 de maio. Dia do Vidraceiro.";
const APOIO = "Quem transforma projeto em obra.";

// Dia do Vidraceiro passa no teste (a) do §12.4 — é data do setor. Pilar MARCA.
// Não representa produto, obra nem pessoas da empresa, então §8.2 permite gerar.
const BRIEF: Brief = {
  pilar: "MARCA",
  tema: "Dia do Vidraceiro",
  angulo: "homenagem a quem transforma projeto em obra — o parceiro nº 1 da EM Vidros",
  data: "18/05",
  precisaFotoReal: false,
};

const problemas = validarTextoDaArte(HEADLINE, APOIO);
if (problemas.length) {
  console.error("Texto da arte reprovou no capítulo 16:\n" + formatarProblemas(problemas));
  process.exit(1);
}

const arg = (process.argv[2] ?? "ambos") as Formato | "ambos";
const formatos: Formato[] = arg === "ambos" ? ["feed", "stories"] : [arg];
const STYLES = stylesFor(BRIEF.pilar);
const DARK = new Set(["faixa-teal"]);
mkdirSync("out/spike", { recursive: true });

console.log(`Pilar ${BRIEF.pilar} → estilos: ${STYLES.join(", ")}`);

for (const formato of formatos) {
  console.log(`\n=== ${formato} ===`);
  const t0 = Date.now();
  const results = await Promise.allSettled(
    STYLES.map((styleId) =>
      generateArt({
        prompt: buildPrompt({ styleId, formato, brief: BRIEF, headline: HEADLINE, apoio: APOIO }),
        formato,
        logoVariant: DARK.has(styleId) ? "branco" : "cor",
      }),
    ),
  );
  results.forEach((r, i) => {
    const styleId = STYLES[i]!;
    const name = `out/spike/${formato}-v${i + 1}-${styleId}.jpg`;
    if (r.status === "fulfilled") {
      writeFileSync(name, r.value.jpeg);
      console.log(`✓ ${name} (${(r.value.jpeg.byteLength / 1024).toFixed(0)} KB) id=${r.value.interactionId}`);
    } else {
      console.error(`✗ ${styleId}: ${r.reason}`);
    }
  });
  console.log(`tempo: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
