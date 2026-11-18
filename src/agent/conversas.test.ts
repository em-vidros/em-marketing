import { expect, test } from "bun:test";
import { primeira } from "../db";
import { q } from "../v2/banco";
import { purgarConversasApagadas } from "./conversas";

test("a purga remove as conversas que a lixeira antiga marcou e as tarefas delas, e deixa o post", async () => {
  const agora = Date.now();
  const { id: postId } = (await primeira(q<{ id: number }>`INSERT INTO posts (headline, arts) VALUES ('Fica na Biblioteca', '[]') RETURNING id`))!;
  const conversa = (id: string, apagadaEm: number | null) =>
    q`INSERT INTO conversas (id, bot_id, user_id, post_id, apagada_em) VALUES (${id}, 'chefe', 'u-purga', ${postId}, ${apagadaEm})`;
  await conversa("purga-velha", agora - 40 * 86_400_000);
  await conversa("purga-recente", agora - 60_000);
  await conversa("purga-viva", null);
  await q`INSERT INTO tarefas (id, conversa_id, bot_id, pedido, status, criada_em, atualizada_em) VALUES ('purga-t', 'purga-velha', 'post', 'x', 'concluida', 1, 1)`;

  await purgarConversasApagadas();
  await purgarConversasApagadas();

  const restantes = await q`SELECT id FROM conversas WHERE user_id = 'u-purga' ORDER BY id`;
  expect(restantes).toEqual([{ id: "purga-viva" }]);
  expect(await q`SELECT 1 FROM tarefas WHERE id = 'purga-t'`).toEqual([]);
  expect(await q`SELECT headline FROM posts WHERE id = ${postId}`).toEqual([{ headline: "Fica na Biblioteca" }]);
});
