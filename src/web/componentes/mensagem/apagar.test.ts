import { expect, test } from "bun:test";
import { ErroDeApi } from "../../api";
import type { Mensagem } from "../../tipos";
import type { Aviso } from "../menu/conversas";
import { criarPilhaDeDesfazer } from "../menu/desfazer";
import { type ApiMensagens, criarApagarMensagem, type Remocao } from "./apagar";

const usuario = (id: string): Mensagem => ({ id, role: "user", parts: [{ type: "text", text: id }] });
const bot = (id: string, delegou = false): Mensagem => ({
  id,
  role: "assistant",
  parts: delegou
    ? [
        {
          type: "tool-delegar_post",
          toolCallId: `t-${id}`,
          state: "output-available",
          input: { pedido: "arte" },
          output: { tarefaId: 1 },
        } as unknown as Mensagem["parts"][number],
      ]
    : [{ type: "text", text: id }],
});

/** Um servidor de mentira com a regra do real: apagar devolve as removidas e as vizinhas, restaurar põe entre elas. */
function servidor(inicial: Mensagem[], falhaAo?: keyof ApiMensagens) {
  let salvas = [...inicial];
  const api: ApiMensagens = {
    async apagar(_, id) {
      if (falhaAo === "apagar") throw new ErroDeApi(409, "O bot ainda está respondendo nesta conversa.");
      const i = salvas.findIndex((m) => m.id === id);
      const prox = salvas.findIndex((m, j) => j > i && m.role === "user");
      const fim = salvas[i]!.role === "user" ? (prox === -1 ? salvas.length : prox) : i + 1;
      const r: Remocao = { removidas: salvas.slice(i, fim), depoisDe: salvas[i - 1]?.id ?? null, antesDe: salvas[fim]?.id ?? null };
      salvas = salvas.toSpliced(i, fim - i);
      return structuredClone(r);
    },
    async restaurar(_, r) {
      const inicio = r.depoisDe === null ? 0 : salvas.findIndex((m) => m.id === r.depoisDe) + 1;
      salvas = salvas.toSpliced(inicio, 0, ...r.removidas);
      return structuredClone(salvas);
    },
  };
  return { api, salvas: () => salvas };
}

function montar(falhaAo?: keyof ApiMensagens) {
  const inicial = [usuario("u1"), bot("b1"), usuario("u2"), bot("b2", true), usuario("u3"), bot("b3")];
  const srv = servidor(inicial, falhaAo);
  let tela = [...inicial];
  const avisos: Aviso[] = [];
  const pilha = criarPilhaDeDesfazer();
  const apagar = criarApagarMensagem("c1", { ler: () => tela, escrever: (m) => (tela = m), ocupado: () => false }, srv.api, pilha, (a) => avisos.push(a));
  return { apagar, pilha, avisos, srv, tela: () => tela.map((m) => m.id) };
}

test("apagar o turno e desfazer pela pilha do app devolve as mensagens na mesma ordem, na tela e no servidor", async () => {
  const s = montar();
  await s.apagar("u2");
  expect(s.tela()).toEqual(["u1", "b1", "u3", "b3"]);
  expect(s.avisos).toEqual([{ tipo: "desfazivel", chave: expect.any(Number), texto: "Mensagem apagada. As artes e agendamentos feitos continuam valendo." }]);

  expect(s.pilha.desfazerUltimo()).not.toBeNull();
  await Bun.sleep(0);
  const ordem = ["u1", "b1", "u2", "b2", "u3", "b3"];
  expect(s.tela()).toEqual(ordem);
  expect(s.srv.salvas().map((m) => m.id)).toEqual(ordem);
  expect(s.pilha.vazia()).toBe(true);
});

test("o servidor recusa o apagar: a mensagem volta ao lugar, o erro aparece e não sobra desfazer", async () => {
  const s = montar("apagar");
  await s.apagar("b1");
  expect(s.tela()).toEqual(["u1", "b1", "u2", "b2", "u3", "b3"]);
  expect(s.avisos).toEqual([{ tipo: "erro", texto: "Não deu para apagar a mensagem. O bot ainda está respondendo nesta conversa." }]);
  expect(s.pilha.vazia()).toBe(true);
});
