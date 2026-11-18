import { Hono } from "hono";
import { z } from "zod";
import type { Usuario } from "../server/auth";
import { criarArte, listarArtes, novaCena, pegarArte, trocarCamadas, type Estudio } from "./artes";
import { EXTENSOES, ehChave, TIPO_DA_EXTENSAO, type Extensao } from "./arquivos";
import { Camadas, FORMATOS, type Formato } from "./camadas";
import { criarReferencia, editarLeitura, listarReferencias, removerReferencia, restaurarReferencia } from "./referencias";
import { renderizar } from "./render";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TAMANHO_MAXIMO = 10 * 1024 * 1024;

const Leitura = z.object({ leitura: z.string().trim().min(1, "A leitura não pode ficar vazia.").max(2000, "A leitura passa de 2.000 caracteres.") });
const NovaArte = z.object({
  pedido: z.string().trim().min(3, "Descreva a arte em pelo menos 3 letras.").max(1000),
  formato: z.enum(Object.keys(FORMATOS) as [Formato, ...Formato[]], "O formato é feed ou story."),
});
const TrocaDeCamadas = z.object({ camadas: Camadas });

type Ambiente = { Variables: { usuario: Usuario } };

const erro = (mensagem: string) => ({ erro: mensagem });

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
  for (const rota of ["/referencias/:id", "/referencias/:id/*", "/artes/:id", "/artes/:id/*"]) {
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
    const leitura = await estudio.ia.lerReferencia(bytes, arquivo.type);
    const chave = await arquivos.salvar(bytes, extensao);
    return c.json(await criarReferencia(banco, { arquivo: chave, leitura, criadaPor: c.get("usuario").id }), 201);
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

  api.get("/arquivos/:chave", async (c) => {
    const chave = c.req.param("chave");
    const bytes = ehChave(chave) ? await arquivos.ler(chave) : null;
    if (!bytes) return c.json(erro("Não encontrado."), 404);
    const tipo = TIPO_DA_EXTENSAO[chave.split(".").pop() as Extensao];
    return new Response(bytes, { headers: { "content-type": tipo, "cache-control": "private, max-age=31536000, immutable" } });
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
    return arte ? c.json(arte) : c.json(erro("Não encontrado."), 404);
  });

  api.put("/artes/:id/camadas", async (c) => {
    const r = await corpo(c.req.raw, TrocaDeCamadas);
    if (!r.ok) return c.json(erro(r.problema), 400);
    const arte = await trocarCamadas(banco, c.req.param("id"), r.dados.camadas);
    return arte ? c.json(arte) : c.json(erro("Não encontrado."), 404);
  });

  api.post("/artes/:id/cena", async (c) => {
    const arte = await novaCena(estudio, c.req.param("id"));
    return arte ? c.json(arte) : c.json(erro("Não encontrado."), 404);
  });

  api.get("/artes/:id/png", async (c) => {
    const arte = await pegarArte(banco, c.req.param("id"));
    const cena = arte && (await arquivos.ler(arte.cena));
    if (!arte || !cena) return c.json(erro("Não encontrado."), 404);
    return new Response(await renderizar(arte.formato, cena, arte.camadas), { headers: { "content-type": "image/png" } });
  });

  return api;
}
