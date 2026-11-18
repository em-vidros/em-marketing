const r = await Bun.build({
  entrypoints: ["src/server/vercel.ts"],
  outdir: "api",
  naming: "_pacote.js",
  target: "bun",
  external: ["sharp", "@resvg/resvg-js", "@electric-sql/pglite"],
});
if (!r.success) {
  for (const log of r.logs) console.error(log);
  process.exit(1);
}
console.log("função empacotada em api/_pacote.js");
