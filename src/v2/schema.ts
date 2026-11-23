import { sql } from "drizzle-orm";
import { boolean, doublePrecision, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { Pilar } from "../domain/art/pipeline";
import { AJUSTES_NEUTROS, type Ajustes, type Camada, type Formato } from "./camadas";

export const referencias = pgTable(
  "referencias",
  {
    id: uuid().primaryKey().defaultRandom(),
    arquivo: text().notNull(),
    leitura: text().notNull(),
    leituraEditadaPor: text(),
    pilares: text().array().$type<Pilar[]>().notNull().default(sql`'{}'::text[]`),
    criadaPor: text().notNull(),
    criadaEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
    removidaEm: timestamp({ withTimezone: true }),
  },
  // Dois cliques em Guardar ao mesmo tempo não criam duas referências do mesmo arquivo.
  (t) => [uniqueIndex("referencias_arquivo_ativa").on(t.arquivo).where(sql`${t.removidaEm} is null`)],
);

export const artes = pgTable("artes", {
  id: uuid().primaryKey().defaultRandom(),
  pedido: text().notNull(),
  formato: text().$type<Formato>().notNull(),
  cena: text().notNull(),
  promptDaCena: text().notNull(),
  referencias: uuid().array().notNull(),
  camadas: jsonb().$type<Camada[]>().notNull(),
  ajustes: jsonb().$type<Ajustes>().notNull().default(AJUSTES_NEUTROS),
  criadaPor: text().notNull(),
  criadaEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  atualizadaEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

/**
 * O que a equipe informa do crédito da OpenAI: o saldo que o painel mostra ou um depósito. O saldo
 * na tela é o último saldo informado, mais os depósitos depois dele, menos o custo medido desde então.
 */
export const movimentosDoSaldo = pgTable("movimentos_do_saldo", {
  id: uuid().primaryKey().defaultRandom(),
  tipo: text().$type<"saldo" | "deposito">().notNull(),
  valor: doublePrecision().notNull(),
  por: text().notNull(),
  em: timestamp({ withTimezone: true }).notNull().defaultNow(),
  removidoEm: timestamp({ withTimezone: true }),
});

export type Referencia = typeof referencias.$inferSelect;
export type Arte = typeof artes.$inferSelect;

// Tabelas do better-auth (login com Google). Os nomes e campos são os que o adaptador do drizzle espera.
const criadoEm = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: criadoEm(),
  updatedAt: criadoEm(),
});

export const session = pgTable("session", {
  id: text().primaryKey(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  token: text().notNull().unique(),
  createdAt: criadoEm(),
  updatedAt: criadoEm(),
  ipAddress: text(),
  userAgent: text(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: text()
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamp({ withTimezone: true }),
  refreshTokenExpiresAt: timestamp({ withTimezone: true }),
  scope: text(),
  password: text(),
  createdAt: criadoEm(),
  updatedAt: criadoEm(),
});

export const verification = pgTable("verification", {
  id: text().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: criadoEm(),
  updatedAt: criadoEm(),
});
