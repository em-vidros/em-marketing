import { readdirSync } from "node:fs";
import type { BunRequest } from "bun";
import { BOTS } from "../agent/bots";
import { conversaDoUsuario, conversasDoUsuario, mensagensDaConversa } from "../agent/conversas";
import { pegarTarefa, tarefasAtivas, tarefasDaConversa } from "../agent/tarefas";
import { db } from "../db";
import { auth, usuarioDa, type Usuario } from "./auth";
import { rotaDeChat, type OpcoesChat } from "./chat";

/** Ícones e logos de brand/assets (espelho da pasta oficial; `bun run assets`). Lidos no boot, servidos da memória. */
const marca = Object.fromEntries([
  ...readdirSync("brand/assets/web").map((nome) => [`/${nome}`, Bun.file(`brand/assets/web/${nome}`)] as const),
  ...readdirSync("brand/assets/logo")
    .filter((nome) => nome.endsWith(".svg"))
    .map((nome) => [`/logo/${nome}`, Bun.file(`brand/assets/logo/${nome}`)] as const),
]);

const naoEncontrado = () => Response.json({ erro: "Não encontrado." }, { status: 404 });

/** A sessão é lida uma vez aqui; a rota recebe o usuário já tipado. */
function comSessao<P extends string>(rota: (req: BunRequest<P>, usuario: Usuario) => Response | Promise<Response>) {
  return async (req: BunRequest<P>) => {
    const usuario = await usuarioDa(req);
    return usuario ? rota(req, usuario) : Response.json({ erro: "Entre para continuar." }, { status: 401 });
  };
}

const bots = Object.values(BOTS).map(({ id, nome, descricao, sugestoes }) => ({ id, nome, descricao, sugestoes }));

export function rotas(opcoes: OpcoesChat = {}) {
  return {
    ...marca,
    "/health": () => Response.json({ ok: true, ts: new Date().toISOString() }),

    "/api/auth/*": (req: Request) => auth.handler(req),

    "/api/bots": { GET: comSessao(() => Response.json(bots)) },
    "/api/chat": { POST: comSessao(rotaDeChat(opcoes)) },
    "/api/conversas": { GET: comSessao((_, u) => Response.json(conversasDoUsuario(u.id))) },
    "/api/conversas/:id": {
      GET: comSessao<"/api/conversas/:id">((req, u) => {
        const conversa = conversaDoUsuario(u.id, req.params.id);
        return conversa ? Response.json({ conversa, mensagens: mensagensDaConversa(conversa.id) }) : naoEncontrado();
      }),
    },
    "/api/conversas/:id/tarefas": {
      GET: comSessao<"/api/conversas/:id/tarefas">((req, u) =>
        conversaDoUsuario(u.id, req.params.id) ? Response.json(tarefasDaConversa(req.params.id)) : naoEncontrado(),
      ),
    },
    "/api/tarefas/:id": {
      GET: comSessao<"/api/tarefas/:id">((req, u) => {
        const tarefa = pegarTarefa(req.params.id);
        return tarefa && conversaDoUsuario(u.id, tarefa.conversaId) ? Response.json(tarefa) : naoEncontrado();
      }),
    },
    "/api/atividade": { GET: comSessao((_, u) => Response.json(tarefasAtivas(u.id))) },
    "/api/*": naoEncontrado,

    // Público de propósito: a Meta baixa a imagem por esta URL na hora de publicar, sem sessão.
    // O id é aleatório de 128 bits e expira depois da publicação.
    "/media/:id": (req: BunRequest<"/media/:id">) => {
      const row = db.query("SELECT path, expired FROM media WHERE id = ?").get(req.params.id) as { path: string; expired: number } | null;
      if (!row || row.expired) return naoEncontrado();
      return new Response(Bun.file(row.path), { headers: { "content-type": "image/jpeg" } });
    },
  };
}
