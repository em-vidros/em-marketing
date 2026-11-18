import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { Camada, Formato } from "./camadas";

export const referencias = pgTable("referencias", {
  id: uuid().primaryKey().defaultRandom(),
  arquivo: text().notNull(),
  leitura: text().notNull(),
  leituraEditadaPor: text(),
  criadaPor: text().notNull(),
  criadaEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  removidaEm: timestamp({ withTimezone: true }),
});

export const artes = pgTable("artes", {
  id: uuid().primaryKey().defaultRandom(),
  pedido: text().notNull(),
  formato: text().$type<Formato>().notNull(),
  cena: text().notNull(),
  promptDaCena: text().notNull(),
  referencias: uuid().array().notNull(),
  camadas: jsonb().$type<Camada[]>().notNull(),
  criadaPor: text().notNull(),
  criadaEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  atualizadaEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
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
