/**
 * Roda o arnês inteiro da Fase 1. Entra no CI antes do build da imagem.
 *
 * Ordem proposital: fronteira primeiro, porque uma quebra de camada explica
 * qualquer falha depois dela, e reinicio por último, porque é o mais caro.
 *
 * Nenhum destes toca rede ou pede chave de API. Rodar sem `.env` é o caso normal.
 */

const SUITES = [
  "fronteira",
  "migracoes",
  "schema",
  "transicoes",
  "lease",
  "artefatos",
  "arte-offline",
  "adaptadores",
  "aprovacao",
  "controle",
  "workers",
  "reinicio",
] as const;

const inicio = Date.now();
const falharam: string[] = [];

for (const suite of SUITES) {
  const t0 = Date.now();
  const p = Bun.spawn(["bun", `scripts/verificar/${suite}.ts`], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ADAPTADORES: "fake" },
  });
  const [saida, erro, codigo] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  const s = ((Date.now() - t0) / 1000).toFixed(1);
  if (codigo === 0) {
    console.log(`ok\t${suite} (${s}s)`);
  } else {
    falharam.push(suite);
    console.error(`FALHOU\t${suite} (${s}s)\n${saida}${erro}`);
  }
}

const total = ((Date.now() - inicio) / 1000).toFixed(1);
if (falharam.length) {
  console.error(`\nverificar: ${falharam.length} suíte(s) vermelha(s): ${falharam.join(", ")} (${total}s)`);
  process.exit(1);
}
console.log(`\nverificar: ok — ${SUITES.length} suítes, sem rede e sem chave (${total}s)`);
