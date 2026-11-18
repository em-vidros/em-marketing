type Manipulador = (req: Request) => Response | Promise<Response>;
type PorMetodo = Partial<Record<string, Manipulador>>;

/**
 * A mesma tabela de rotas do `Bun.serve`, para quem não tem `Bun.serve` (a função da Vercel).
 * Segue a precedência do Bun: caminho exato, depois com `:parametro`, depois `*`, e o prefixo mais longo vence.
 * Valores que não são função nem objeto de métodos (arquivos estáticos) ficam de fora: a Vercel serve o `dist/`.
 */
export function roteador(tabela: Record<string, unknown>): Manipulador {
  const rotas = Object.entries(tabela)
    .flatMap(([caminho, alvo]) => {
      const porMetodo = typeof alvo === "function" ? { "*": alvo as Manipulador } : ehPorMetodo(alvo) ? alvo : null;
      return porMetodo ? [{ caminho, porMetodo, padrao: new URLPattern({ pathname: caminho }), peso: peso(caminho) }] : [];
    })
    .sort((a, b) => a.peso[0] - b.peso[0] || b.peso[1] - a.peso[1]);

  return (req) => {
    const { pathname } = new URL(req.url);
    for (const rota of rotas) {
      const achou = rota.padrao.exec({ pathname });
      if (!achou) continue;
      const manipulador = rota.porMetodo[req.method] ?? rota.porMetodo["*"] ?? (req.method === "HEAD" ? rota.porMetodo.GET : undefined);
      if (!manipulador) return Response.json({ erro: "Método não permitido." }, { status: 405 });
      const params = Object.fromEntries(Object.entries(achou.pathname.groups).filter(([chave]) => !/^\d+$/.test(chave)));
      Object.defineProperty(req, "params", { value: params, configurable: true });
      return manipulador(req);
    }
    return Response.json({ erro: "Não encontrado." }, { status: 404 });
  };
}

const METODOS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

function ehPorMetodo(alvo: unknown): alvo is PorMetodo {
  return typeof alvo === "object" && alvo !== null && Object.keys(alvo).length > 0 && Object.entries(alvo).every(([m, f]) => METODOS.has(m) && typeof f === "function");
}

/** [classe, tamanho do prefixo fixo]: exato 0, com parâmetro 1, curinga 2. */
function peso(caminho: string): [number, number] {
  const classe = caminho.includes("*") ? 2 : caminho.includes(":") ? 1 : 0;
  return [classe, caminho.split(/[:*]/)[0]!.length];
}
