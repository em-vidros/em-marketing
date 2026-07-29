// Fase 1 (bloqueante): gera 3 variações reais do post "Dia do Vidraceiro 18/05"
// em Feed (1080×1350) e Stories (1080×1920) e valida os critérios da §3.4.
//
// Uso: GEMINI_API_KEY=... bun scripts/spike-arte.ts [feed|stories|ambos]
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { generateArt, type Formato } from "../src/art/generate";

const HEADLINE = "Feliz Dia do Vidraceiro!";
const APOIO = "18 de maio — o dia de quem transforma vidro em obra.";

const STYLES: { id: string; file: string }[] = [
  { id: "minimal-editorial", file: "styles/minimal-editorial.md" },
  { id: "festivo-comemorativo", file: "styles/festivo-comemorativo.md" },
  { id: "institucional-foto", file: "styles/institucional-foto.md" },
];

function buildPrompt(styleFile: string, formato: Formato): string {
  const md = readFileSync(styleFile, "utf8");
  const template = md.match(/```\n([\s\S]*?)```/)?.[1];
  if (!template) throw new Error(`Sem template em ${styleFile}`);
  const formatDesc =
    formato === "feed"
      ? "post (4:5 portrait, 1080x1350)"
      : "story (9:16 vertical, 1080x1920 — keep the top 250px and bottom 250px free of any critical element)";
  return template
    .replace("{FORMAT_DESC}", formatDesc)
    .replace(
      "{TIPO_POST_DESCRIPTION}",
      "Commemorative post for 'Dia do Vidraceiro' (Brazilian Glazier's Day, May 18th), honoring the glaziers who are EM Vidros' main partners.",
    )
    .replace("{HEADLINE}", HEADLINE)
    .replace("{SUPPORT_LINES}", formato === "feed" ? `Support line: "${APOIO}"` : "");
}

const arg = (process.argv[2] ?? "ambos") as Formato | "ambos";
const formatos: Formato[] = arg === "ambos" ? ["feed", "stories"] : [arg];
mkdirSync("out/spike", { recursive: true });

for (const formato of formatos) {
  console.log(`\n=== ${formato} ===`);
  const t0 = Date.now();
  const results = await Promise.allSettled(
    STYLES.map((s) =>
      generateArt({
        prompt: buildPrompt(s.file, formato),
        formato,
        logoVariant: s.id === "premium-escuro" ? "branco" : "cor",
      }),
    ),
  );
  results.forEach((r, i) => {
    const style = STYLES[i]!;
    const name = `out/spike/${formato}-v${i + 1}-${style.id}.jpg`;
    if (r.status === "fulfilled") {
      writeFileSync(name, r.value.jpeg);
      console.log(`✓ ${name} (${(r.value.jpeg.byteLength / 1024).toFixed(0)} KB) id=${r.value.interactionId}`);
    } else {
      console.error(`✗ ${style.id}: ${r.reason}`);
    }
  });
  console.log(`tempo: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}
