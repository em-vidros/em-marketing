import { timingSafeEqual } from "node:crypto";
import { purgarConversasApagadas } from "../agent/conversas";
import { tickDaFila } from "../domain/scheduler";
import { rotaMcp } from "../mcp/servidor";
import { criarApi } from "../v2/api";
import { referenciasParaGerar } from "../v2/referencias";
import { modosDeEntrar, usuarioDa } from "./auth";
import { iniciar } from "./iniciar";
import { rotas } from "./rotas";

type Manipulador = (req: Request) => Response | Promise<Response>;

/** Mudar o que os bots fazem e trocar a conta do Instagram fica com os admins (ADMIN_EMAILS). */
function soAdmin(manipulador: Manipulador): Manipulador {
  return async (req) => {
    const usuario = await usuarioDa(req);
    if (!usuario) return Response.json({ erro: "Entre para continuar." }, { status: 401 });
    if (!usuario.admin) return Response.json({ erro: "Só os administradores mudam isso. Fale com o Henrique ou o Ricardo." }, { status: 403 });
    return manipulador(req);
  };
}

const iguais = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** O cron da Vercel manda `Authorization: Bearer $CRON_SECRET`. */
async function cronDiario(req: Request) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || !iguais(req.headers.get("authorization") ?? "", `Bearer ${segredo}`)) return Response.json({ erro: "Não autorizado." }, { status: 401 });
  await tickDaFila();
  const purgadas = await purgarConversasApagadas();
  return Response.json({ ok: true, purgadas });
}

/** A tabela de rotas inteira, igual no servidor local e na função da Vercel. */
export async function rotasDoApp() {
  const { estudio, segredoAprovacao } = await iniciar();
  const api = criarApi(estudio, usuarioDa);
  const apiNova = (req: Request) => api.fetch(req);
  const base = rotas({ segredoAprovacao, carregarReferencias: (o) => referenciasParaGerar(estudio, o), estudio });

  return {
    ...base,
    ...Object.fromEntries(["/api/referencias", "/api/referencias/*", "/api/pecas-prontas", "/api/pecas-prontas/*", "/api/artes", "/api/artes/*", "/api/arquivos", "/api/arquivos/*", "/api/fontes"].map((rota) => [rota, apiNova])),
    "/api/bots/:id/config": { ...base["/api/bots/:id/config"], PUT: soAdmin(base["/api/bots/:id/config"].PUT as Manipulador) },
    "/api/bots/:id/versoes/:versao/restaurar": { POST: soAdmin(base["/api/bots/:id/versoes/:versao/restaurar"].POST as Manipulador) },
    "/api/bots/:id/padrao": { POST: soAdmin(base["/api/bots/:id/padrao"].POST as Manipulador) },
    "/auth/meta": soAdmin(base["/auth/meta"] as Manipulador),
    "/auth/meta/callback": soAdmin(base["/auth/meta/callback"] as Manipulador),
    "/api/eu": async (req: Request) => {
      const usuario = await usuarioDa(req);
      return usuario ? Response.json(usuario) : Response.json({ erro: "Entre para continuar." }, { status: 401 });
    },
    "/api/entrar": () => Response.json(modosDeEntrar),
    "/api/mcp": rotaMcp,
    "/api/cron/diario": cronDiario,
  };
}
