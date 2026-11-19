import { z } from "zod";
import type { Camada } from "./camadas";
import { arquivoDaMarca, CATEGORIAS, chaveDaFonte, NOME_DE_FAMILIA, PESOS, urlNoCdn, type Categoria, type FamiliaDoCatalogo, type Peso } from "./fontes";

const URL_DO_CATALOGO = "https://api.fontsource.org/v1/fonts";
const VALIDADE_DO_CATALOGO = 24 * 60 * 60 * 1000;
const NOVA_TENTATIVA = 10 * 60 * 1000;
const ESPERA = 8000;

const RespostaDoCatalogo = z.array(
  z.object({ family: z.string(), weights: z.array(z.number()), styles: z.array(z.string()), subsets: z.array(z.string()), category: z.string(), type: z.string() }),
);

type Catalogo = Map<string, FamiliaDoCatalogo>;

let guardado: { catalogo: Catalogo; validoAte: number } | null = null;
let buscando: Promise<Catalogo | null> | null = null;
const bytes = new Map<string, Promise<ArrayBuffer>>();

/**
 * O catálogo do Google Fonts que o editor oferece, guardado na memória por um dia. Se o Fontsource não responde,
 * segue com o catálogo velho; sem nenhum, devolve null e quem chamou decide.
 */
export async function catalogoDeFontes(): Promise<Catalogo | null> {
  if (guardado && Date.now() < guardado.validoAte) return guardado.catalogo;
  buscando ??= buscarCatalogo().finally(() => (buscando = null));

  return buscando;
}

/** Confere as fontes das camadas de texto. As da marca nem olham o catálogo; sem catálogo, aceita e avisa no log. */
export async function fonteRecusada(camadas: Camada[]): Promise<string | null> {
  const textos = camadas.flatMap((c) => (c.tipo === "texto" && !arquivoDaMarca(c.fonte, c.peso) ? [c] : []));
  if (textos.length === 0) return null;

  const catalogo = await catalogoDeFontes();
  if (!catalogo) {
    console.warn("fontes: catálogo do Fontsource fora do ar, gravando sem conferir", textos.map((t) => chaveDaFonte(t.fonte, t.peso)));
    return null;
  }

  for (const { fonte, peso } of textos) {
    const familia = catalogo.get(fonte);
    if (!familia) return `A fonte ${fonte} não está no catálogo.`;
    if (!familia.pesos.includes(peso)) return `A fonte ${fonte} não tem o peso ${peso}.`;
  }

  return null;
}

/** O TTF de um peso do catálogo, baixado uma vez por processo. Uma falha não fica guardada, para a próxima tentar de novo. */
export function bytesDaFonte(familia: string, peso: Peso): Promise<ArrayBuffer> {
  const chave = chaveDaFonte(familia, peso);
  const guardada = bytes.get(chave);
  if (guardada) return guardada;

  const baixando = baixar(urlNoCdn(familia, peso, "ttf")).then((resposta) => resposta.arrayBuffer()).catch((erro: unknown) => {
    bytes.delete(chave);
    throw erro;
  });
  bytes.set(chave, baixando);

  return baixando;
}

async function buscarCatalogo(): Promise<Catalogo | null> {
  try {
    const resposta = RespostaDoCatalogo.parse(await (await baixar(URL_DO_CATALOGO)).json());
    const catalogo: Catalogo = new Map(resposta.flatMap(familiaDoCatalogo).map((f) => [f.familia, f]));
    guardado = { catalogo, validoAte: Date.now() + VALIDADE_DO_CATALOGO };

    return catalogo;
  } catch (erro) {
    console.error("fontes: não deu para baixar o catálogo do Fontsource", erro);
    if (guardado) guardado.validoAte = Date.now() + NOVA_TENTATIVA;

    return guardado?.catalogo ?? null;
  }
}

/** Fica só o que o render sabe desenhar: famílias do Google com estilo normal, subset latin e nome simples. */
function familiaDoCatalogo(entrada: z.infer<typeof RespostaDoCatalogo>[number]): FamiliaDoCatalogo[] {
  const pesos = PESOS.filter((p) => entrada.weights.includes(p));
  const usavel =
    entrada.type === "google" && entrada.styles.includes("normal") && entrada.subsets.includes("latin") && NOME_DE_FAMILIA.test(entrada.family) && pesos.length > 0;
  if (!usavel || !ehCategoria(entrada.category)) return [];

  return [{ familia: entrada.family, pesos, categoria: entrada.category }];
}

const ehCategoria = (categoria: string): categoria is Categoria => Object.hasOwn(CATEGORIAS, categoria);

async function baixar(url: string): Promise<Response> {
  const resposta = await fetch(url, { signal: AbortSignal.timeout(ESPERA) });
  if (!resposta.ok) throw new Error(`${url} respondeu ${resposta.status}`);

  return resposta;
}
