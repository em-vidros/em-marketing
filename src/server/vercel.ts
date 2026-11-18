import { rotasDoApp } from "./app";
import { roteador } from "./roteador";

// A função única da Vercel: tudo que não é arquivo estático do dist/ cai aqui (vercel.json).
// Um boot que falha não fica guardado: o próximo pedido tenta de novo.
let pronto: Promise<ReturnType<typeof roteador>> | undefined;

function subir() {
  pronto ??= rotasDoApp()
    .then(roteador)
    .catch((erro) => {
      console.error("boot falhou:", erro);
      pronto = undefined;
      throw erro;
    });
  return pronto;
}

export default {
  fetch: async (req: Request) => {
    try {
      return (await subir())(req);
    } catch {
      return Response.json({ erro: "O servidor não subiu. Tente de novo em instantes." }, { status: 503 });
    }
  },
};
