import { expect, test } from "bun:test";
import { db } from "../db";
import { PRAZO_DA_LIXEIRA, purgarConversasApagadas } from "./conversas";

test("a purga remove a conversa apagada há mais de 30 dias e as tarefas dela, e deixa o post", () => {
  const agora = Date.now();
  const { id: postId } = db.query("INSERT INTO posts (headline, arts) VALUES ('Fica na Biblioteca', '[]') RETURNING id").get() as { id: number };
  const conversa = (id: string, apagadaEm: number | null) =>
    db.query("INSERT INTO conversas (id, bot_id, user_id, post_id, apagada_em) VALUES (?, 'chefe', 'u-purga', ?, ?)").run(id, postId, apagadaEm);
  conversa("purga-velha", agora - PRAZO_DA_LIXEIRA - 1);
  conversa("purga-recente", agora - PRAZO_DA_LIXEIRA + 60_000);
  conversa("purga-viva", null);
  db.query("INSERT INTO tarefas (id, conversa_id, bot_id, pedido, status, criada_em, atualizada_em) VALUES ('purga-t', 'purga-velha', 'post', 'x', 'concluida', 1, 1)").run();

  purgarConversasApagadas(agora);
  purgarConversasApagadas(agora);

  const restantes = db.query("SELECT id FROM conversas WHERE user_id = 'u-purga' ORDER BY id").all();
  expect(restantes).toEqual([{ id: "purga-recente" }, { id: "purga-viva" }]);
  expect(db.query("SELECT 1 FROM tarefas WHERE id = 'purga-t'").get()).toBeNull();
  expect(db.query("SELECT headline FROM posts WHERE id = ?").get(postId)).toEqual({ headline: "Fica na Biblioteca" });
});
