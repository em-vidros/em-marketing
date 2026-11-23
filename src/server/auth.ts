import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
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
