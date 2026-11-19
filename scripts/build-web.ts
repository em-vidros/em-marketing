import { cp, mkdir, rm } from "node:fs/promises";
import tailwind from "bun-plugin-tailwind";

// Monta o site estático que a Vercel serve; a API roda em api/index.ts.
await rm("dist", { recursive: true, force: true });
const r = await Bun.build({
  entrypoints: ["src/web/index.html"],
  outdir: "dist",
  // Caminho absoluto: em /c/:id um "./chunk.js" vira /c/chunk.js, que o rewrite da SPA responde com HTML.
  publicPath: "/",
  // O editor de arte (Leafer e mediabunny) vira um pedaço à parte, baixado só quando a tela de arte abre.
  splitting: true,
  minify: true,
  sourcemap: "linked",
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!r.success) {
  for (const log of r.logs) console.error(log);
  process.exit(1);
}
await cp("brand/assets/web", "dist", { recursive: true });
await mkdir("dist/logo", { recursive: true });
await cp("brand/assets/logo", "dist/logo", { recursive: true, filter: (f) => f.endsWith(".svg") || !f.split("/").pop()!.includes(".") });
await cp("brand/assets/fonts", "dist/fontes", { recursive: true, filter: (f) => f.endsWith(".ttf") || !f.split("/").pop()!.includes(".") });
await cp("src/web/privacidade.html", "dist/privacidade.html");
console.log(`site montado em dist/ (${r.outputs.length} arquivos)`);
