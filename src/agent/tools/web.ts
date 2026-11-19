import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { openai } from "@ai-sdk/openai";
import { tool } from "ai";
import { z } from "zod";

/** Busca na web da OpenAI, executada pelo provedor. Num modelo da Anthropic o provedor ignora a tool. */
export const buscaNaWeb = () => openai.tools.webSearch({ searchContextSize: "medium" });

/** O texto que volta ao modelo. Uma página longa passa disso com menu, rodapé e anúncios. */
export const LIMITE_DO_TEXTO = 20_000;
const LIMITE_DE_BYTES = 2_000_000;
const MAX_REDIRECIONAMENTOS = 5;
const TEMPO_MAXIMO_MS = 10_000;

/**
 * Endereços que a página não pode alcançar: a máquina do servidor, a rede interna e o serviço de
 * metadados da nuvem (169.254.169.254), que entrega credenciais a quem pedir de dentro.
 * O BlockList confere o IPv4 escrito como IPv6 (::ffff:10.0.0.1) contra as faixas IPv4.
 */
const BLOQUEADOS = new BlockList();
for (const [rede, prefixo] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  BLOQUEADOS.addSubnet(rede, prefixo, "ipv4");
for (const [rede, prefixo] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const)
  BLOQUEADOS.addSubnet(rede, prefixo, "ipv6");

const ehBloqueado = (ip: string) => BLOQUEADOS.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");

export type Resolver = (host: string) => Promise<string[]>;

const resolverDns: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

export interface Rede {
  resolver: Resolver;
  buscar: (url: URL, init: RequestInit) => Promise<Response>;
}

const REDE: Rede = { resolver: resolverDns, buscar: (url, init) => fetch(url, init) };

export type Leitura =
  | { ok: true; url: string; titulo: string | null; texto: string; cortado: boolean; achou?: boolean }
  | { ok: false; motivo: string };

/** O pedaço que volta ao modelo: do começo, ou de um pouco antes do trecho procurado, que numa lei longa fica longe do topo. */
function janela(texto: string, procurar: string | undefined) {
  const achado = procurar ? texto.toLocaleLowerCase("pt-BR").indexOf(procurar.trim().toLocaleLowerCase("pt-BR")) : -1;
  const inicio = Math.max(0, achado - 200);
  return { texto: texto.slice(inicio, inicio + LIMITE_DO_TEXTO), cortado: texto.length - inicio > LIMITE_DO_TEXTO, ...(procurar ? { achou: achado >= 0 } : {}) };
}

class Recusada extends Error {}

/** Lança Recusada quando a URL sai da internet pública. Todo endereço do host conta: basta um interno. */
async function conferir(url: URL, resolver: Resolver): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Recusada("Só leio endereços http ou https.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const ips = isIP(host) ? [host] : await resolver(host).catch(() => []);
  if (ips.length === 0) throw new Recusada(`Não achei o endereço ${host}.`);
  if (ips.some(ehBloqueado)) throw new Recusada("Esse endereço é da rede interna; só leio páginas públicas da internet.");
}

async function lerAte(corpo: ReadableStream<Uint8Array> | null, limite: number): Promise<Uint8Array> {
  if (!corpo) return new Uint8Array();
  const leitor = corpo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  while (total < limite) {
    const { done, value } = await leitor.read();
    if (done) break;
    partes.push(value);
    total += value.byteLength;
  }
  await leitor.cancel();
  return Bun.concatArrayBuffers(partes, limite, true);
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

const decodificar = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (inteira, e: string) => {
    if (e[0] !== "#") return ENTIDADES[e.toLowerCase()] ?? inteira;
    const n = e[1] === "x" || e[1] === "X" ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : inteira;
  });

/** O texto legível de um HTML: sem script, estilo e tags, com uma quebra de linha por bloco. */
export function textoDoHtml(html: string): { titulo: string | null; texto: string } {
  const titulo = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const texto = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer|\/blockquote)\b[^>]*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<[^>]+>/g, " ");
  const linhas = decodificar(texto)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  return { titulo: titulo ? decodificar(titulo).replace(/\s+/g, " ").trim() || null : null, texto: linhas.join("\n") };
}

/**
 * Sites do governo ainda servem windows-1252, às vezes sem declarar (a CLT no Planalto), e ler como UTF-8
 * troca todo acento por �. Sem declaração, vale o que o navegador faz: UTF-8 se os bytes forem UTF-8 válido.
 * `stream` evita o falso erro no último caractere, que o corte em LIMITE_DE_BYTES pode partir no meio.
 */
function decodificarBytes(bytes: Uint8Array, tipo: string): string {
  const declarado =
    /charset=["']?([\w-]+)/i.exec(tipo)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(new TextDecoder("latin1").decode(bytes.subarray(0, 4096)))?.[1];
  for (const [rotulo, fatal] of [[declarado, false], ["utf-8", true]] as const) {
    if (!rotulo) continue;
    try {
      return new TextDecoder(rotulo, { fatal }).decode(bytes, { stream: true });
    } catch {}
  }
  return new TextDecoder("windows-1252").decode(bytes);
}

const ehTexto = (tipo: string) => /^(text\/|application\/(json|xml|xhtml\+xml|ld\+json))/i.test(tipo);

/**
 * Baixa uma página pública e devolve o texto. Cada redirecionamento passa pela mesma conferência,
 * para um site público não mandar o servidor para a rede interna.
 * Resta a janela entre conferir o DNS e o fetch resolver de novo; ler_pagina não manda cookie nem
 * credencial, e só devolve texto.
 */
export async function lerPagina(endereco: string, { procurar, sinal }: { procurar?: string; sinal?: AbortSignal } = {}, rede: Rede = REDE): Promise<Leitura> {
  let url: URL;
  try {
    url = new URL(endereco);
  } catch {
    return { ok: false, motivo: "Isso não é um endereço válido. Mande a URL inteira, com https://." };
  }
  const limite = AbortSignal.timeout(TEMPO_MAXIMO_MS);
  const signal = sinal ? AbortSignal.any([sinal, limite]) : limite;
  try {
    for (let saltos = 0; ; saltos++) {
      await conferir(url, rede.resolver);
      const res = await rede.buscar(url, { redirect: "manual", signal, headers: { "user-agent": "Mozilla/5.0 (compatible; EMVidrosBot/1.0)", accept: "text/html,text/plain;q=0.9,*/*;q=0.5" } });
      const destino = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && destino) {
        await res.body?.cancel();
        if (saltos >= MAX_REDIRECIONAMENTOS) return { ok: false, motivo: "A página redireciona demais." };
        url = new URL(destino, url);
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        return { ok: false, motivo: `A página respondeu ${res.status}.` };
      }
      const tipo = res.headers.get("content-type") ?? "text/html";
      if (!ehTexto(tipo)) {
        await res.body?.cancel();
        return { ok: false, motivo: `Isso não é uma página de texto (${tipo.split(";")[0]}).` };
      }
      const bruto = decodificarBytes(await lerAte(res.body, LIMITE_DE_BYTES), tipo);
      const { titulo, texto } = /html|xml/i.test(tipo) ? textoDoHtml(bruto) : { titulo: null, texto: bruto.trim() };
      return { ok: true, url: url.href, titulo, ...janela(texto, procurar) };
    }
  } catch (e) {
    if (e instanceof Recusada) return { ok: false, motivo: e.message };
    if (limite.aborted) return { ok: false, motivo: `A página não respondeu em ${TEMPO_MAXIMO_MS / 1000} segundos.` };
    if (sinal?.aborted) throw e;
    return { ok: false, motivo: "Não consegui abrir a página." };
  }
}

export const toolsDeWeb = {
  pesquisar_web: buscaNaWeb(),
  ler_pagina: tool({
    description:
      "Abre uma página pública da internet e devolve até 20 mil caracteres do texto dela. Use para ler uma lei, uma norma, um artigo ou um site que o usuário mandou ou que pesquisar_web achou.",
    inputSchema: z.object({
      url: z.string().describe("O endereço completo, com https://."),
      procurar: z.string().optional().describe("Numa página longa, o trecho que interessa, como \"Art. 143\". O texto volta a partir dele."),
    }),
    execute: ({ url, procurar }, { abortSignal }) => lerPagina(url, { procurar, sinal: abortSignal }),
  }),
};
