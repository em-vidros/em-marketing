import { describe, expect, test } from "bun:test";
import { lerPagina, LIMITE_DO_TEXTO, type Rede } from "./web";

/** DNS e servidores de mentira: nenhum teste sai para a rede. `buscadas` diz quais URLs chegaram a ser pedidas. */
function rede(dns: Record<string, string[]>, paginas: Record<string, () => Response>) {
  const buscadas: string[] = [];
  const r: Rede = {
    resolver: async (host) => dns[host] ?? [],
    buscar: async (url) => {
      buscadas.push(url.href);
      const pagina = paginas[url.href];
      return pagina ? pagina() : new Response("não achei", { status: 404 });
    },
  };
  return { r, buscadas };
}

const html = (corpo: string) => () => new Response(corpo, { headers: { "content-type": "text/html; charset=utf-8" } });
const redireciona = (para: string) => () => new Response(null, { status: 302, headers: { location: para } });

describe("ler_pagina", () => {
  test("devolve o texto de uma página pública, sem script nem tags, cortado no limite", async () => {
    const longa = "a".repeat(LIMITE_DO_TEXTO + 10);
    const { r } = rede(
      { "gov.br": ["170.246.252.243"] },
      { "https://gov.br/clt": html(`<html><head><title>CLT &amp; férias</title><script>roubar()</script></head><body><h1>Art. 130</h1><p>30 dias&nbsp;corridos</p><p>${longa}</p></body></html>`) },
    );

    const leitura = await lerPagina("https://gov.br/clt", {}, r);

    expect(leitura).toMatchObject({ ok: true, titulo: "CLT & férias", cortado: true });
    expect(leitura.ok && leitura.texto).toStartWith("Art. 130\n30 dias corridos\naaa");
    expect(leitura.ok && leitura.texto.length).toBe(LIMITE_DO_TEXTO);
    expect(leitura.ok && leitura.texto).not.toContain("roubar");
    expect(await lerPagina("https://gov.br/clt", { procurar: "30 DIAS" }, r)).toMatchObject({ ok: true, achou: true, texto: expect.stringMatching(/^Art\. 130\n30 dias corridos/) });
  });

  test("lê em windows-1252 a página que não declara charset e não é UTF-8, como a CLT no Planalto, e em UTF-8 a que é", async () => {
    const latin1 = new Uint8Array([...new TextEncoder().encode("<html><body><p>F"), 0xe9, 0x72, 0x69, 0x61, 0x73, ...new TextEncoder().encode("</p></body></html>")]);
    const utf8 = new TextEncoder().encode("<html><body><p>Férias</p></body></html>");
    const { r } = rede(
      { "planalto.gov.br": ["170.246.252.10"] },
      {
        "https://planalto.gov.br/clt": () => new Response(latin1, { headers: { "content-type": "text/html" } }),
        "https://planalto.gov.br/utf8": () => new Response(utf8, { headers: { "content-type": "text/html" } }),
      },
    );

    expect(await lerPagina("https://planalto.gov.br/clt", {}, r)).toMatchObject({ ok: true, texto: "Férias" });
    expect(await lerPagina("https://planalto.gov.br/utf8", {}, r)).toMatchObject({ ok: true, texto: "Férias" });
  });

  test.each([
    ["localhost", "http://localhost:3000/api/bots", { localhost: ["127.0.0.1"] }],
    ["IP privado", "http://10.0.0.5/", {}],
    ["metadados da nuvem", "http://169.254.169.254/latest/meta-data/", {}],
    ["IPv6 local", "http://[::1]/", {}],
    ["IPv4 escrito como IPv6", "http://[::ffff:192.168.0.1]/", {}],
    ["host com um dos endereços na rede interna", "https://misto.example/", { "misto.example": ["93.184.216.34", "192.168.1.10"] }],
  ])("recusa %s sem fazer o pedido", async (_, url, dns) => {
    const { r, buscadas } = rede(dns, {});

    const leitura = await lerPagina(url, {}, r);

    expect(leitura).toEqual({ ok: false, motivo: "Esse endereço é da rede interna; só leio páginas públicas da internet." });
    expect(buscadas).toEqual([]);
  });

  test("recusa esquema que não é http", async () => {
    const { r, buscadas } = rede({}, {});

    expect(await lerPagina("file:///etc/passwd", {}, r)).toEqual({ ok: false, motivo: "Só leio endereços http ou https." });
    expect(buscadas).toEqual([]);
  });

  test("um site público que redireciona para a rede interna não leva o pedido até lá", async () => {
    const { r, buscadas } = rede(
      { "publico.example": ["93.184.216.34"], "interno.example": ["10.1.2.3"] },
      { "https://publico.example/": redireciona("http://interno.example/admin") },
    );

    const leitura = await lerPagina("https://publico.example/", {}, r);

    expect(leitura).toEqual({ ok: false, motivo: "Esse endereço é da rede interna; só leio páginas públicas da internet." });
    expect(buscadas).toEqual(["https://publico.example/"]);
  });
});
