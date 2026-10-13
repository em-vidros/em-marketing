import { betterAuth, type BetterAuthOptions } from "better-auth";
import { APIError } from "better-auth/api";
import { getMigrations } from "better-auth/db/migration";
import { db } from "../db";

/** Quem pode criar conta. Vem de ALLOWED_EMAILS, separado por vírgula. */
const permitidos: ReadonlySet<string> = new Set(
  (process.env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
);

const opcoes = {
  database: db,
  emailAndPassword: { enabled: true, minPasswordLength: 6 },
  databaseHooks: {
    user: {
      create: {
        // No hook de criação do usuário, não no endpoint de cadastro: vale para qualquer caminho que crie conta.
        before: async (user) => {
          if (!permitidos.has(user.email.toLowerCase())) throw new APIError("FORBIDDEN", { message: "Este e-mail não tem acesso." });
        },
      },
    },
  },
} satisfies BetterAuthOptions;

// Cria só as tabelas e colunas que faltam; rodar a cada boot não muda um banco em dia.
await (await getMigrations(opcoes)).runMigrations();

export const auth = betterAuth(opcoes);

export interface Usuario {
  id: string;
  email: string;
  nome: string;
}

export async function usuarioDa(req: Request): Promise<Usuario | null> {
  const sessao = await auth.api.getSession({ headers: req.headers });
  return sessao && { id: sessao.user.id, email: sessao.user.email, nome: sessao.user.name };
}
