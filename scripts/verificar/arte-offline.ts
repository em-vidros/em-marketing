/**
 * O caminho da arte inteiro, sem rede: designer fake → normalização real → preview.
 *
 * Prova o que o DESIGN.md promete na costura offline. O fake emite na dimensão que
 * o Nano Banana 2 emite, então a normalização exercitada aqui é literalmente a que
 * roda em produção, e não uma imitação dela.
 */

import { readFileSync } from "node:fs";
import sharp from "sharp";
import tokens from "../../brand/tokens.json";
import { derivarPreview, normalizarMestre, sha256 } from "../../src/adaptadores/imagem";
import { FakeDesigner, FakeDiretorCriativo } from "../../src/adaptadores/fake";
import { carregarContextoMarca } from "../../src/adaptadores/marca";
import type { Formato, Pedido } from "../../src/modelos/tipos";

let falhas = 0;

function ok(condicao: unknown, descricao: string): void {
  if (condicao) return console.log(`ok      ${descricao}`);
  falhas++;
  console.error(`FALHOU  ${descricao}`);
}

const marca = carregarContextoMarca();
const logo = readFileSync(tokens.assets.logoColor);
const criativo = new FakeDiretorCriativo();
const designer = new FakeDesigner();
const pedido: Pedido = {
  theme: "vidro temperado de 10 mm para fachada",
  format: "both",
  objective: "mostrar o ganho de segurança para o vidraceiro",
};

const rodada1 = await criativo.direcoes({ pedido, marca, rodada: 1 });
ok(rodada1.length === 3, "o diretor criativo devolve exatamente três direções");
ok(
  new Set(rodada1.map((d) => d.headline)).size === 3,
  "as três direções da rodada trazem headlines distintos",
);

const rodada2 = await criativo.direcoes({
  pedido,
  marca,
  rodada: 2,
  excluir: rodada1.map((d) => d.direction_id),
});
const repetidas = rodada2.filter((d) => rodada1.some((a) => a.direction_id === d.direction_id));
ok(rodada2.length === 3 && repetidas.length === 0, "a rodada 2 devolve três direções inéditas");

for (const formato of ["feed", "stories"] as const) {
  const esperado = tokens.formats[formato].generation.expected;
  const final = tokens.formats[formato].final;

  const gerados = await Promise.all(
    rodada1.map((direcao) => designer.gerar({ direcao, formato, logo })),
  );
  const brutos = await Promise.all(gerados.map((g) => sharp(g.png).metadata()));
  ok(
    brutos.every((m) => m.width === esperado.width && m.height === esperado.height),
    `${formato}: o designer emite ${esperado.width}×${esperado.height}, a dimensão do Nano Banana 2`,
  );

  const mestres = await Promise.all(gerados.map((g) => normalizarMestre(g.png, formato)));
  const metas = await Promise.all(mestres.map((m) => sharp(m.png).metadata()));
  ok(
    metas.every((m) => m.width === final.width && m.height === final.height),
    `${formato}: o mestre mede exatamente ${final.width}×${final.height}`,
  );
  ok(
    metas.every((m) => m.format === "png" && m.space === "srgb"),
    `${formato}: o mestre é PNG em sRGB`,
  );
  ok(
    new Set(mestres.map((m) => m.sha256)).size === 3,
    `${formato}: as três variações têm três sha256 distintos`,
  );

  const previews = await Promise.all(mestres.map((m) => derivarPreview(m.png)));
  const metasPreview = await Promise.all(previews.map((p) => sharp(p.jpeg).metadata()));
  ok(
    metasPreview.every((m) => m.format === "jpeg"),
    `${formato}: o preview é JPEG`,
  );
  ok(
    previews.every((p) => p.jpeg.byteLength <= tokens.output.maxBytes),
    `${formato}: o preview cabe no teto de ${tokens.output.maxBytes} bytes`,
  );

  const base = gerados[0]!;
  const editado = await designer.editar({
    base: base.png,
    instrucao: "deixe o headline mais alto e aumente o respiro na base",
    formato,
    logo,
    refId: base.refId,
  });
  const metaEditado = await sharp(editado.png).metadata();
  ok(
    sha256(editado.png) !== sha256(base.png),
    `${formato}: o ajuste muda os bytes da imagem`,
  );
  ok(
    metaEditado.width === esperado.width && metaEditado.height === esperado.height,
    `${formato}: o ajuste preserva a dimensão da base`,
  );

  const denovo = await normalizarMestre(
    (await designer.gerar({ direcao: rodada1[0]!, formato, logo })).png,
    formato,
  );
  ok(
    denovo.sha256 === mestres[0]!.sha256,
    `${formato}: a mesma entrada devolve o mesmo mestre, byte por byte`,
  );
}

if (falhas) {
  console.error(`\narte-offline: ${falhas} asserção(ões) falharam`);
  process.exit(1);
}
console.log("\narte-offline: ok");
