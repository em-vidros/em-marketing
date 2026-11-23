import { Resvg } from "@resvg/resvg-js";
import { readdirSync } from "node:fs";
import { Hono } from "hono";
import sharp from "sharp";
import { z } from "zod";
import type { Usuario } from "../server/auth";
import { criarArte, gravarEdicao, listarArtes, novaCena, pegarArte, separarElementos, separavel, type Estudio } from "./artes";
import { EXTENSOES, FORMATO_DA_EXTENSAO, PIXELS_MAXIMOS, ehChave, TIPO_DA_EXTENSAO, type Extensao } from "./arquivos";
import { Ajustes, Camadas, FORMATOS, type Formato } from "./camadas";
import { catalogoDeFontes, fonteRecusada } from "./fontsource";
import { criarReferencia, editarLeitura, guardarNaBiblioteca, listarReferencias, removerReferencia, restaurarReferencia } from "./referencias";
import { conversaDaPeca, editarLegendaDaPeca, listarPecasProntas, pegarPecaPronta, receberPecaPronta, removerPecaPronta, restaurarPecaPronta } from "./pecas-prontas";
import { renderizar } from "./render";

/** O servidor não tem fontes de sistema: texto dentro de um SVG enviado sai com as fontes da marca. */
const PASTA_DAS_FONTES = `${process.cwd()}/brand/assets/fonts`;
const FONTES_DO_SVG = {
  loadSystemFonts: false,
  fontFiles: readdirSync(PASTA_DAS_FONTES)
    .filter((n) => /\.(ttf|otf)$/i.test(n))
    .map((n) => `${PASTA_DAS_FONTES}/${n}`),
  defaultFontFamily: "Poppins",
  sansSerifFamily: "Poppins",
  serifFamily: "Playfair Display",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TAMANHO_MAXIMO = 10 * 1024 * 1024;

const Leitura = z.object({ leitura: z.string().trim().min(1, "A leitura não pode ficar vazia.").max(2000, "A leitura passa de 2.000 caracteres.") });
const LegendaDaPeca = z.object({ legenda: z.string().max(2200, "A legenda passa de 2.200 caracteres, o limite do Instagram.") });
const NovaArte = z.object({
  pedido: z.string().trim().min(3, "Descreva a arte em pelo menos 3 letras.").max(1000),
  formato: z.enum(Object.keys(FORMATOS) as [Formato, ...Formato[]], "O formato é feed ou story."),
});
const Edicao = z.object({ camadas: Camadas, ajustes: Ajustes });

type Ambiente = { Variables: { usuario: Usuario } };

const erro = (mensagem: string) => ({ erro: mensagem });

/** O tipo que o navegador declara não prova nada: o conteúdo precisa abrir, ser do formato da extensão e caber no teto de pixels. */
async function recusaDaImagem(bytes: Uint8Array, extensao: Extensao): Promise<string | null> {
  const m = await sharp(bytes)
    .metadata()
    .catch(() => null);
  if (!m?.width || !m.height) return "Não deu para ler essa imagem. Confira se o arquivo não está corrompido.";
  if (m.format !== FORMATO_DA_EXTENSAO[extensao]) return "O conteúdo do arquivo não é PNG, JPEG ou WebP.";
  if (m.width * m.height > PIXELS_MAXIMOS) return "A imagem passa de 40 megapixels. Reduza e tente de novo.";
  return null;
}

/**
 * As rotas novas: biblioteca de referências e artes com camadas.
 * `usuarioDa` vem de fora para os testes não precisarem do better-auth.
 */
export function criarApi(estudio: Estudio, usuarioDa: (req: Request) => Promise<Usuario | null>) {
  const { banco, arquivos } = estudio;
  const api = new Hono<Ambiente>().basePath("/api");

  api.use(async (c, next) => {
    const usuario = await usuarioDa(c.req.raw);
    if (!usuario) return c.json(erro("Entre para continuar."), 401);
    c.set("usuario", usuario);
    await next();
  });

  // Um :id que não é uuid vira 404 aqui, antes de chegar ao Postgres.
  for (const rota of ["/referencias/:id", "/referencias/:id/*", "/pecas-prontas/:id", "/pecas-prontas/:id/*", "/artes/:id", "/artes/:id/*"]) {
    api.use(rota, async (c, next) => (UUID.test(c.req.param("id") ?? "") ? next() : c.json(erro("Não encontrado."), 404)));
  }

  api.notFound((c) => c.json(erro("Não encontrado."), 404));

  api.onError((e, c) => {
    console.error(e);
    return c.json(erro(`Algo falhou do nosso lado: ${e.message}`), 500);
  });

  async function corpo<S extends z.ZodType>(req: Request, schema: S) {
    const r = schema.safeParse(await req.json().catch(() => null));
    return r.success ? ({ ok: true, dados: r.data as z.output<S> } as const) : ({ ok: false, problema: r.error.issues[0]?.message ?? "Pedido inválido." } as const);
  }

  api.get("/referencias", async (c) => c.json(await listarReferencias(banco)));

  api.post("/referencias", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const arquivo = form?.get("arquivo");
    if (!(arquivo instanceof File)) return c.json(erro("Mande a imagem no campo arquivo."), 400);
    const extensao: Extensao | undefined = EXTENSOES[arquivo.type as keyof typeof EXTENSOES];
    if (!extensao) return c.json(erro("A referência precisa ser PNG, JPEG ou WebP."), 400);
    if (arquivo.size > TAMANHO_MAXIMO) return c.json(erro("A imagem passa de 10 MB."), 400);
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const recusa = await recusaDaImagem(bytes, extensao);
    if (recusa) return c.json(erro(recusa), 400);
    const { leitura, pilares } = await estudio.ia.lerReferencia(bytes, arquivo.type);
    const chave = await arquivos.salvar(bytes, extensao);
    return c.json(await criarReferencia(banco, { arquivo: chave, leitura, pilares, criadaPor: c.get("usuario").id }), 201);
  });

  api.patch("/referencias/:id", async (c) => {
    const r = await corpo(c.req.raw, Leitura);
    if (!r.ok) return c.json(erro(r.problema), 400);
    const editada = await editarLeitura(banco, c.req.param("id"), r.dados.leitura, c.get("usuario").id);
    return editada ? c.json(editada) : c.json(erro("Não encontrado."), 404);
  });

  api.delete("/referencias/:id", async (c) =>
    (await removerReferencia(banco, c.req.param("id"))) ? c.body(null, 204) : c.json(erro("Não encontrado."), 404),
  );

  api.post("/referencias/:id/restaurar", async (c) => {
    const restaurada = await restaurarReferencia(banco, c.req.param("id"));
    return restaurada ? c.json(restaurada) : c.json(erro("Não encontrado."), 404);
  });

  api.get("/pecas-prontas", async (c) => c.json(await listarPecasProntas(banco)));

  // A peça pronta nunca passa por /referencias: as duas tabelas são separadas para que uma não entre no lugar da outra.
  api.post("/pecas-prontas", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const arquivo = form?.get("arquivo");
    if (!(arquivo instanceof File)) return c.json(erro("Mande a imagem no campo arquivo."), 400);
    const extensao: Extensao | undefined = EXTENSOES[arquivo.type as keyof typeof EXTENSOES];
    if (!extensao) return c.json(erro("A peça pronta precisa ser PNG, JPEG ou WebP."), 400);
    if (arquivo.size > TAMANHO_MAXIMO) return c.json(erro("A imagem passa de 10 MB."), 400);
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const recusa = await recusaDaImagem(bytes, extensao);
    if (recusa) return c.json(erro(recusa), 400);
    const r = await receberPecaPronta(estudio, { bytes, criadaPor: c.get("usuario").id });
    return r.ok ? c.json(r.peca, 201) : c.json(erro(r.motivo), 400);
  });

  api.get("/pecas-prontas/:id", async (c) => {
    const peca = await pegarPecaPronta(banco, c.req.param("id"));
    return peca ? c.json(peca) : c.json(erro("Não encontrado."), 404);
  });

  api.patch("/pecas-prontas/:id", async (c) => {
    const r = await corpo(c.req.raw, LegendaDaPeca);
    if (!r.ok) return c.json(erro(r.problema), 400);
    const editada = await editarLegendaDaPeca(banco, c.req.param("id"), r.dados.legenda);
    return editada ? c.json(editada) : c.json(erro("Não encontrado."), 404);
  });

  api.delete("/pecas-prontas/:id", async (c) =>
    (await removerPecaPronta(banco, c.req.param("id"))) ? c.body(null, 204) : c.json(erro("Não encontrado."), 404),
  );

  api.post("/pecas-prontas/:id/restaurar", async (c) => {
    const restaurada = await restaurarPecaPronta(banco, c.req.param("id"));
    return restaurada ? c.json(restaurada) : c.json(erro("Não encontrado."), 404);
  });

  api.post("/pecas-prontas/:id/conversa", async (c) => {
    const conversa = await conversaDaPeca(banco, c.get("usuario").id, c.req.param("id"));
    return conversa ? c.json(conversa, 201) : c.json(erro("Não encontrado."), 404);
  });

  // A imagem que a pessoa cola no chat sobe aqui, sem a IA ler: ela vale só para o próximo pedido, e a mensagem guarda a chave.
  api.post("/arquivos", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const arquivo = form?.get("arquivo");
    if (!(arquivo instanceof File)) return c.json(erro("Mande a imagem no campo arquivo."), 400);
    const extensao: Extensao | undefined = EXTENSOES[arquivo.type as keyof typeof EXTENSOES];
    if (!extensao) return c.json(erro("A imagem precisa ser PNG, JPEG ou WebP."), 400);
    if (arquivo.size > TAMANHO_MAXIMO) return c.json(erro("A imagem passa de 10 MB."), 400);
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const recusa = await recusaDaImagem(bytes, extensao);
    if (recusa) return c.json(erro(recusa), 400);
    return c.json({ chave: await arquivos.salvar(bytes, extensao) }, 201);
  });

  api.post("/arquivos/:chave/referencia", async (c) => {
    const chave = c.req.param("chave");
    const guardada = ehChave(chave) ? await guardarNaBiblioteca(estudio, chave, c.get("usuario").id) : null;
    return guardada ? c.json({ ...guardada.referencia, criada: guardada.criada }, guardada.criada ? 201 : 200) : c.json(erro("Não encontrado."), 404);
  });

  api.get("/arquivos/:chave", async (c) => {
    const chave = c.req.param("chave");
    const bytes = ehChave(chave) ? await arquivos.ler(chave) : null;
    if (!bytes) return c.json(erro("Não encontrado."), 404);
    const tipo = TIPO_DA_EXTENSAO[chave.split(".").pop() as Extensao];
    return new Response(bytes, { headers: { "content-type": tipo, "cache-control": "private, max-age=31536000, immutable" } });
  });

  api.get("/fontes", async (c) => {
    const catalogo = await catalogoDeFontes();
    if (!catalogo) return c.json(erro("O catálogo de fontes não respondeu. As fontes da marca continuam valendo."), 503);
    return c.json([...catalogo.values()], 200, { "cache-control": "private, max-age=86400" });
  });

  api.get("/artes", async (c) => c.json(await listarArtes(banco)));

  api.post("/artes", async (c) => {
    const r = await corpo(c.req.raw, NovaArte);
    if (!r.ok) return c.json(erro(r.problema), 400);
    const arte = await criarArte(estudio, { texto: r.dados.pedido, formato: r.dados.formato, criadaPor: c.get("usuario").id });
    return c.json(arte, 201);
  });

  api.get("/artes/:id", async (c) => {
    const arte = await pegarArte(banco, c.req.param("id"));
    return arte ? c.json({ ...arte, separavel: separavel(arte) }) : c.json(erro("Não encontrado."), 404);
  });

  api.post("/artes/:id/separar", async (c) => {
    const arte = await separarElementos(estudio, c.req.param("id"));
    return arte ? c.json(arte) : c.json(erro("Não encontrado."), 404);
  });

  api.put("/artes/:id", async (c) => {
    const r = await corpo(c.req.raw, Edicao);
    if (!r.ok) return c.json(erro(r.problema), 400);

    const recusa = await fonteRecusada(r.dados.camadas);
    if (recusa) return c.json(erro(recusa), 400);

    const base = c.req.header("if-match");
    const data = base ? new Date(base) : undefined;
    if (data && Number.isNaN(data.getTime())) return c.json(erro("Versão da arte inválida."), 400);
    const gravada = await gravarEdicao(banco, c.req.param("id"), r.dados, data);
    if (!gravada) return c.json(erro("Não encontrado."), 404);
    if ("conflito" in gravada) return c.json({ ...erro("Outra pessoa mudou esta arte enquanto você editava."), arte: gravada.conflito }, 409);
    return c.json(gravada.arte);
  });

  api.post("/artes/:id/cena", async (c) => {
    const arte = await novaCena(estudio, c.req.param("id"));
    return arte ? c.json(arte) : c.json(erro("Não encontrado."), 404);
  });

  // Imagem ou SVG para uma camada do editor. Tudo vira PNG aqui: o SVG é rasterizado pelo resvg, que não roda
  // script, e o arquivo servido depois nunca é um SVG executável no domínio do app.
  api.post("/artes/:id/imagens", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const arquivo = form?.get("arquivo");
    if (!(arquivo instanceof File)) return c.json(erro("Mande a imagem no campo arquivo."), 400);
    if (arquivo.size > TAMANHO_MAXIMO) return c.json(erro("A imagem passa de 10 MB."), 400);
    const ehSvg = arquivo.type === "image/svg+xml" || arquivo.name.toLowerCase().endsWith(".svg");
    if (!ehSvg && !(arquivo.type in EXTENSOES)) return c.json(erro("A imagem precisa ser PNG, JPEG, WebP ou SVG."), 400);
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    let png: Uint8Array;
    try {
      png = ehSvg
        ? new Resvg(Buffer.from(bytes), { fitTo: { mode: "width", value: 2048 }, font: FONTES_DO_SVG }).render().asPng()
        : new Uint8Array(await sharp(bytes).rotate().resize(2048, 2048, { fit: "inside", withoutEnlargement: true }).png().toBuffer());
    } catch {
      return c.json(erro("Não deu para ler essa imagem. Confira se o arquivo não está corrompido."), 400);
    }
    const { width, height } = await sharp(png).metadata();
    if (!width || !height) return c.json(erro("Não deu para ler o tamanho da imagem."), 400);
    const chave = await arquivos.salvar(png, "png");
    return c.json({ chave, proporcao: height / width }, 201);
  });

  api.get("/artes/:id/png", async (c) => {
    const arte = await pegarArte(banco, c.req.param("id"));
    const cena = arte && (await arquivos.ler(arte.cena));
    if (!arte || !cena) return c.json(erro("Não encontrado."), 404);
    return new Response(await renderizar(arte, cena, (chave) => arquivos.ler(chave)), { headers: { "content-type": "image/png" } });
  });

  return api;
}
