import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { z } from "zod";
import { banco } from "../v2/banco";
import { account, session, user, verification } from "../v2/schema";

/** Só entra quem tem e-mail da empresa. */
const DOMINIO = (process.env.DOMINIO_PERMITIDO ?? "emvidros.com.br").toLowerCase();

const ADMINS: ReadonlySet<string> = new Set(
  (process.env.ADMIN_EMAILS ?? "bi@emvidros.com.br,ricardo@emvidros.com.br")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

export const ehDaEmpresa = (email: string) => email.toLowerCase().endsWith(`@${DOMINIO}`);
export const ehAdmin = (email: string) => ADMINS.has(email.toLowerCase());

const recusar = () => {
  throw new APIError("FORBIDDEN", { message: `Só e-mails @${DOMINIO} entram.` });
};

const endereco = process.env.BETTER_AUTH_URL ? new URL(process.env.BETTER_AUTH_URL) : null;
const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          prompt: "select_account" as const,
          // Dica para o Google listar só contas do domínio; quem decide de verdade é o hook abaixo.
          hd: DOMINIO,
        },
      }
    : undefined;

/** Como a tela de entrar oferece o login. A senha só liga com LOGIN_POR_SENHA=1, no `.env` local e nos testes; em produção a única porta é o Google. */
export const modosDeEntrar = { senha: process.env.LOGIN_POR_SENHA === "1", google: Boolean(google) } as const;

/**
 * Abre a sessão de quem o EM Hub confirmou (entradaPeloHub.ts). Sem caminho, o endpoint só existe para o
 * servidor: o handler de /api/auth não o expõe, então ninguém abre sessão mandando um e-mail.
 */
const entradaPeloHub = {
  id: "entrada-pelo-hub",
  endpoints: {
    abrirSessaoPeloHub: createAuthEndpoint.serverOnly(
      { method: "POST", body: z.object({ email: z.string(), nome: z.string() }) },
      async (ctx) => {
        const { internalAdapter } = ctx.context;
        const email = ctx.body.email.toLowerCase();
        const usuario =
          (await internalAdapter.findUserByEmail(email))?.user ??
          (await internalAdapter.createUser({ email, name: ctx.body.nome || email, emailVerified: true }, { method: "em-hub" }));
        const sessao = await internalAdapter.createSession(usuario.id);
        await setSessionCookie(ctx, { session: sessao, user: usuario });
        return ctx.json({ ok: true });
      },
    ),
  },
} satisfies BetterAuthPlugin;

function opcoes() {
  return {
    basePath: "/api/auth",
    ...(endereco && {
      baseURL: endereco.origin,
      trustedOrigins: [endereco.origin],
      advanced: { useSecureCookies: endereco.protocol === "https:" },
    }),
    database: drizzleAdapter(banco(), { provider: "pg", schema: { user, session, account, verification } }),
    socialProviders: google,
    plugins: [entradaPeloHub],
    emailAndPassword: { enabled: modosDeEntrar.senha, minPasswordLength: 6 },
    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },
    session: { cookieCache: { enabled: true, maxAge: 5 * 60 } },
    databaseHooks: {
      user: { create: { before: async (novo) => (ehDaEmpresa(novo.email) ? undefined : recusar()) } },
    },
  } satisfies BetterAuthOptions;
}

// O banco só existe depois de abrirBanco; o better-auth nasce no primeiro uso.
let instancia: ReturnType<typeof betterAuth<ReturnType<typeof opcoes>>> | undefined;
const pronto = () => (instancia ??= betterAuth(opcoes()));

export const auth = {
  handler: (req: Request) => pronto().handler(req),
  get api() {
    return pronto().api;
  },
};

export interface Usuario {
  id: string;
  email: string;
  nome: string;
  admin: boolean;
}

export async function usuarioDa(req: Request): Promise<Usuario | null> {
  const sessao = await pronto().api.getSession({ headers: req.headers });
  if (!sessao || !ehDaEmpresa(sessao.user.email)) return null;
  return { id: sessao.user.id, email: sessao.user.email, nome: sessao.user.name, admin: ehAdmin(sessao.user.email) };
}
