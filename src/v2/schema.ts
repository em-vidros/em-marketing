import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
