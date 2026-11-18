import { rotasDoApp } from "../src/server/app";
import { roteador } from "../src/server/roteador";

// A função única da Vercel: tudo que não é arquivo estático do dist/ cai aqui (vercel.json).
const pronto = rotasDoApp().then(roteador);

export default { fetch: async (req: Request) => (await pronto)(req) };
