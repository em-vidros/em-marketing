// Gera as mesmas artes em medium e em high, pelo caminho do app, e escreve um relatório HTML lado a lado
// com o custo em US$ e o tempo de cada uma. Gasta crédito da OpenAI: mostra a estimativa e pergunta antes.
//
// Uso: bun scripts/comparar-qualidade.ts [N] [--sim] [--pasta <dir>]
// N é o número de pedidos de exemplo (padrão 3, até 5). --sim pula a pergunta.
// As imagens e o relatorio.html vão para ~/comparacao-de-qualidade/<data e hora>, fora do repositório.
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import {
  compararQualidades,
  estimarCusto,
  htmlDoRelatorio,
  PEDIDOS_DE_EXEMPLO,
  QUALIDADES,
  type PedidoParaComparar,
  type PostDoRelatorio,
} from "../src/domain/art/comparar";
import { chaveDe } from "../src/domain/chaves";
import { MODELO_DE_IMAGEM } from "../src/openai";
import { iniciar } from "../src/server/iniciar";
import { referenciasParaGerar } from "../src/v2/referencias";

const argumentos = process.argv.slice(2);
const pulaPergunta = argumentos.includes("--sim");
const iPasta = argumentos.indexOf("--pasta");
const pastaPedida = iPasta >= 0 ? argumentos[iPasta + 1] : undefined;
const textoDoN = argumentos.find((a, i) => !a.startsWith("--") && argumentos[i - 1] !== "--pasta");
const n = textoDoN === undefined ? 3 : Number(textoDoN);
if (!Number.isInteger(n) || n < 1 || n > PEDIDOS_DE_EXEMPLO.length || (iPasta >= 0 && !pastaPedida)) {
  console.error(`Uso: bun scripts/comparar-qualidade.ts [N de 1 a ${PEDIDOS_DE_EXEMPLO.length}] [--sim] [--pasta <dir>]`);
  process.exit(1);
}

const dinheiro = (v: number | null) => (v === null ? "sem custo" : `US$ ${v.toFixed(3)}`);

// O banco embutido não cria a pasta pai; numa cópia nova do repositório ela ainda não existe.
await mkdir("data", { recursive: true });
const { estudio } = await iniciar();
if (!(await chaveDe("openai"))) {
  console.error("Sem chave da OpenAI. Conecte uma na tela de uso ou defina OPENAI_API_KEY.");
  process.exit(1);
}

// Cada pedido leva a âncora que a rotação da Biblioteca daria a ele, a mesma nas duas qualidades.
const pedidos: PedidoParaComparar[] = [];
for (const pedido of PEDIDOS_DE_EXEMPLO.slice(0, n)) {
  const [referencia] = await referenciasParaGerar(estudio, { pilar: pedido.brief.pilar, n: 1 });
  pedidos.push({ pedido, referencia });
}

const estimativa = estimarCusto(n, pedidos.every((p) => p.referencia));
console.log(`${n} pedidos em ${QUALIDADES.join(" e ")}: ${estimativa.chamadas} chamadas ao ${MODELO_DE_IMAGEM}, uma de cada vez.`);
console.log(`Estimativa pela tabela de preços: medium ${dinheiro(estimativa.porQualidade.medium)}, high ${dinheiro(estimativa.porQualidade.high)}, total ${dinheiro(estimativa.total)}.`);
console.log("É uma estimativa: os tokens de saída reais podem passar disso.");

if (!pulaPergunta) {
  if (!process.stdin.isTTY) {
    console.error("Sem terminal para perguntar. Rode de novo com --sim para confirmar o gasto.");
    process.exit(1);
  }
  const leitor = createInterface({ input: process.stdin, output: process.stdout });
  const resposta = (await leitor.question("Gerar e gastar esse crédito? [s/N] ")).trim().toLowerCase();
  leitor.close();
  if (!["s", "sim", "y", "yes"].includes(resposta)) {
    console.log("Nada foi gerado.");
    process.exit(0);
  }
}

const agora = new Date();
const carimbo = agora.toISOString().slice(0, 19).replace(/[:T]/g, "-");
const pasta = pastaPedida ?? join(homedir(), "comparacao-de-qualidade", carimbo);
await mkdir(pasta, { recursive: true });

const pares = await compararQualidades(pedidos, {
  aoMedir: (i, m) => console.log(`${i + 1}/${n} ${m.qualidade}: ${dinheiro(m.custo)}, ${(m.tempoMs / 1000).toFixed(1)} s`),
});

const posts: PostDoRelatorio[] = [];
for (const [i, par] of pares.entries()) {
  const linha = async (q: (typeof QUALIDADES)[number]) => {
    const arquivo = `${String(i + 1).padStart(2, "0")}-${q}.jpg`;
    await Bun.write(join(pasta, arquivo), par[q].jpeg);
    return { arquivo, custo: par[q].custo, tempoMs: par[q].tempoMs, tokensDeSaida: par[q].consumo?.saida ?? null };
  };
  posts.push({
    titulo: par.pedido.titulo,
    headline: par.pedido.headline,
    guia: par.temReferencia ? "Guiada por uma referência da Biblioteca, a mesma nas duas" : "No visual da casa, sem referência",
    medium: await linha("medium"),
    high: await linha("high"),
  });
}

await Bun.write(join(pasta, "relatorio.html"), htmlDoRelatorio({ posts, geradoEm: agora, modelo: MODELO_DE_IMAGEM, estimativa }));
const gasto = pares.reduce((s, p) => s + (p.medium.custo ?? 0) + (p.high.custo ?? 0), 0);
console.log(`\nGasto real: ${dinheiro(gasto)} (estimado ${dinheiro(estimativa.total)}).`);
console.log(`Relatório: ${join(pasta, "relatorio.html")}`);
process.exit(0);
