import { expect, test } from "bun:test";
import type { Conversa } from "../../tipos";
import { type ApiConversas, type Aviso, criarConversas } from "./conversas";

const conversa = (id: string, atualizadaEm: string): Conversa => ({
  id,
  botId: "chefe",
  titulo: `Conversa ${id}`,
  postId: null,
  criadaEm: atualizadaEm,
  atualizadaEm,
  arquivadaEm: null,
});

/** Um servidor de mentira com a mesma regra do real: apagada some da lista até ser restaurada. */
function servidor(falhaAo?: keyof ApiConversas) {
  const linhas = new Map([conversa("a", "2026-10-13 10:00:00"), conversa("b", "2026-10-13 09:00:00")].map((c) => [c.id, { c, apagada: false }]));
  const chamadas: string[] = [];
  const api: ApiConversas = {
    async listar(arquivadas) {
      return [...linhas.values()].filter((l) => !l.apagada && (l.c.arquivadaEm !== null) === arquivadas).map((l) => l.c);
    },
    async mudar(id, m) {
      chamadas.push(`mudar ${id}`);
      if (falhaAo === "mudar") throw new Error("500");
      const l = linhas.get(id)!;
      l.c = { ...l.c, ...(m.titulo ? { titulo: m.titulo } : {}), ...(m.arquivada !== undefined ? { arquivadaEm: m.arquivada ? 1 : null } : {}) };
      return l.c;
    },
    async apagar(id) {
      chamadas.push(`apagar ${id}`);
      if (falhaAo === "apagar") throw new Error("500");
      linhas.get(id)!.apagada = true;
    },
    async restaurar(id) {
      chamadas.push(`restaurar ${id}`);
      linhas.get(id)!.apagada = false;
      return linhas.get(id)!.c;
    },
  };
  return { api, chamadas };
}

const ids = (l: readonly Conversa[]) => l.map((c) => c.id);

test("excluir e depois Desfazer restaura a conversa no servidor e no lugar dela na lista", async () => {
  const { api, chamadas } = servidor();
  const avisos: Aviso[] = [];
  const s = criarConversas(api, (a) => avisos.push(a));
  await s.carregar();

  await s.excluir("a");
  expect(ids(s.ler().ativas)).toEqual(["b"]);
  const aviso = avisos.find((a) => a.tipo === "desfazivel");
  expect(aviso?.tipo === "desfazivel" && aviso.verbo).toBe("excluída");

  if (aviso?.tipo === "desfazivel") aviso.desfazer();
  await Bun.sleep(0);
  expect(chamadas).toEqual(["apagar a", "restaurar a"]);
  expect(ids(s.ler().ativas)).toEqual(["a", "b"]);
  expect(ids(await api.listar(false))).toEqual(["a", "b"]);
  // O ⌘Z depois do toast não desfaz a mesma coisa de novo.
  expect(s.desfazerUltimo()).toBeNull();
});

test("⌘Z desfaz o último arquivamento", async () => {
  const { api } = servidor();
  const s = criarConversas(api, () => {});
  await s.carregar();
  await s.arquivar("b", true);
  expect(ids(s.ler().arquivadas)).toEqual(["b"]);
  expect(s.desfazerUltimo()).not.toBeNull();
  await Bun.sleep(0);
  expect(ids(s.ler().ativas)).toEqual(["a", "b"]);
  expect(ids(await api.listar(true))).toEqual([]);
});

test("falha do servidor devolve a conversa à lista e avisa, sem deixar desfazer pendurado", async () => {
  const { api } = servidor("apagar");
  const avisos: Aviso[] = [];
  const s = criarConversas(api, (a) => avisos.push(a));
  await s.carregar();
  await s.excluir("a");
  expect(ids(s.ler().ativas)).toEqual(["a", "b"]);
  expect(avisos.map((a) => a.tipo)).toEqual(["erro"]);
  expect(s.desfazerUltimo()).toBeNull();
});
