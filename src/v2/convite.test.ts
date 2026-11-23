import { beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { iaDeTeste, estudioDeTeste } from "../../test/estudio";
import { criarApi } from "./api";
import { apagarArte, criarArteComCampos, pegarArte, PedidoInvalido, restaurarArte } from "./artes";
import { camadaDoLogo, FORMATOS, MARGEM, type Camada } from "./camadas";
import { camadasDoAniversario, camadasDoConvite, CamposDoAniversario, CamposDoConvite, diametroDaFoto, PedidoDeArte, TIPOS_DE_ARTE } from "./campos";
import { q } from "./banco";
import { artes } from "./schema";

const ana = { id: "u-ana", email: "ana@emvidros.com.br", nome: "Ana", admin: false };

const CONVITE = { titulo: "Você é nosso convidado especial", evento: "Café da manhã especial", data: "28 de novembro", hora: "A partir das 8h", local: "Imperatriz" };

const textos = (camadas: Camada[]) => Object.fromEntries(camadas.flatMap((c) => (c.tipo === "texto" ? [[c.id, c.texto] as const] : [])));
const ids = (camadas: Camada[]) => camadas.map((c) => c.id);

const parse = (campos: unknown) => CamposDoConvite.parse(campos);

describe("camadas do convite", () => {
  test("cada campo vira uma camada com o texto exato, e o logo vai por último", () => {
    const camadas = camadasDoConvite("feed", parse(CONVITE), { fundoEscuro: false });
    expect(textos(camadas)).toEqual({ titulo: CONVITE.titulo, evento: CONVITE.evento, data: CONVITE.data, hora: CONVITE.hora, local: CONVITE.local });
    expect(ids(camadas)).toEqual(["cartao", "titulo", "evento", "data", "hora", "local", "logo"]);
  });

  test("campo vazio ou só com espaço não gera camada, e o resto fecha o espaço", () => {
    const completo = camadasDoConvite("feed", parse(CONVITE), { fundoEscuro: false });
    const sem = camadasDoConvite("feed", parse({ ...CONVITE, hora: "   ", observacao: "" }), { fundoEscuro: false });
    expect(ids(sem)).toEqual(["cartao", "titulo", "evento", "data", "local", "logo"]);
    const y = (camadas: Camada[], id: string) => camadas.find((c) => c.id === id)!.y;
    expect(y(sem, "local")).toBeLessThan(y(completo, "local"));
    expect(ids(camadasDoConvite("feed", parse({ evento: CONVITE.evento }), { fundoEscuro: false }))).toEqual(["evento", "logo"]);
  });

  test("a observação aparece quando preenchida", () => {
    const camadas = camadasDoConvite("feed", parse({ ...CONVITE, observacao: "Confirme presença com seu vendedor" }), { fundoEscuro: false });
    expect(textos(camadas).observacao).toBe("Confirme presença com seu vendedor");
  });

  test("espaços repetidos e quebras de linha viram um espaço, e o resto do texto fica como foi escrito", () => {
    const campos = parse({ evento: "  Café   da\nmanhã  especial ", data: "28/11 · 8h" });
    expect(campos).toMatchObject({ evento: "Café da manhã especial", data: "28/11 · 8h" });
  });

  for (const formato of ["feed", "story"] as const) {
    test(`o logo fica na área da marca e nada passa da margem no ${formato}`, () => {
      const camadas = camadasDoConvite(formato, parse({ ...CONVITE, observacao: "Confirme presença com seu vendedor" }), { fundoEscuro: false });
      const logo: Camada = camadas.find((c) => c.id === "logo")!;
      expect(logo).toEqual(camadaDoLogo(formato, false));
      const { largura, altura, topo, base } = FORMATOS[formato];
      expect(logo.x + logo.largura).toBe(largura - MARGEM);
      expect(logo.y + Math.round(logo.largura * (1888 / 2272))).toBe(altura - base);
      for (const c of camadas.filter((c) => c.tipo !== "logo")) {
        expect(c.x).toBeGreaterThanOrEqual(MARGEM);
        expect(c.x + c.largura).toBeLessThanOrEqual(largura - MARGEM);
        expect(c.y).toBeGreaterThanOrEqual(topo);
      }
    });

    test(`com todos os campos no tamanho máximo, o cartão termina acima do logo no ${formato}`, () => {
      const cheio = Object.fromEntries(TIPOS_DE_ARTE.convite.campos.map((c) => [c.nome, "Palavra ".repeat(30).slice(0, c.max).trim()]));
      const camadas = camadasDoConvite(formato, parse(cheio), { fundoEscuro: false });
      const cartao = camadas.find((c) => c.tipo === "forma");
      const logo = camadas.find((c) => c.id === "logo")!;
      expect(cartao?.tipo === "forma" ? cartao.y + cartao.altura : Infinity).toBeLessThanOrEqual(logo.y);
    });
  }

  test("fundo escuro troca título, evento e logo para branco", () => {
    const camadas = camadasDoConvite("feed", parse(CONVITE), { fundoEscuro: true });
    expect(camadas.find((c) => c.id === "titulo")).toMatchObject({ cor: "#FFFFFF" });
    expect(camadas.find((c) => c.id === "logo")).toMatchObject({ variante: "branca" });
    expect(camadas.find((c) => c.id === "data")).toMatchObject({ cor: "#414141" });
  });

  test("um convite sem nenhum campo é recusado", () => {
    expect(CamposDoConvite.safeParse({}).success).toBe(false);
    expect(CamposDoConvite.safeParse({ titulo: "  ", local: null }).success).toBe(false);
    expect(CamposDoConvite.safeParse({ titulo: "x".repeat(49) }).success).toBe(false);
  });
});

describe("camadas do aniversário", () => {
  const campos = CamposDoAniversario.parse({ nome: "Ana Paula", mensagem: "Feliz aniversário. Obrigado por construir a EM Vidros com a gente." });

  test("nome e mensagem exatos, sem foto não há camada de imagem", () => {
    const camadas = camadasDoAniversario("feed", campos, { fundoEscuro: false });
    expect(textos(camadas)).toEqual({ nome: "Ana Paula", mensagem: "Feliz aniversário. Obrigado por construir a EM Vidros com a gente." });
    expect(ids(camadas)).toEqual(["nome", "mensagem", "logo"]);
  });

  test("com foto, o círculo fica centralizado abaixo do texto e acima do logo", () => {
    const chave = `${crypto.randomUUID()}.png`;
    for (const formato of ["feed", "story"] as const) {
      const camadas = camadasDoAniversario(formato, campos, { fundoEscuro: false, foto: chave });
      const foto: Camada = camadas.find((c) => c.tipo === "imagem")!;
      const logo = camadas.find((c) => c.id === "logo")!;
      const mensagem = camadas.find((c) => c.id === "mensagem")!;
      expect(foto).toMatchObject({ chave, proporcao: 1, largura: diametroDaFoto(formato) });
      expect(foto.x * 2 + foto.largura).toBe(FORMATOS[formato].largura);
      expect(foto.y).toBeGreaterThan(mensagem.y);
      expect(foto.y + foto.largura).toBeLessThanOrEqual(logo.y);
    }
  });

  test("com nome e mensagem no tamanho máximo, a foto termina acima do logo", () => {
    const cheio = CamposDoAniversario.parse(Object.fromEntries(TIPOS_DE_ARTE.aniversario.campos.map((c) => [c.nome, "Palavra ".repeat(30).slice(0, c.max).trim()])));
    for (const formato of ["feed", "story"] as const) {
      const camadas = camadasDoAniversario(formato, cheio, { fundoEscuro: false, foto: `${crypto.randomUUID()}.png` });
      const foto = camadas.find((c) => c.tipo === "imagem")!;
      expect(foto.y + foto.largura).toBeLessThanOrEqual(camadas.find((c) => c.id === "logo")!.y);
    }
  });

  test("campo vazio não aparece: só o nome, ou só a foto", () => {
    const so = camadasDoAniversario("feed", CamposDoAniversario.parse({ nome: "Ana", mensagem: "" }), { fundoEscuro: false });
    expect(ids(so)).toEqual(["nome", "logo"]);
    const chave = `${crypto.randomUUID()}.jpg`;
    const foto = camadasDoAniversario("feed", CamposDoAniversario.parse({ foto: chave }), { fundoEscuro: false, foto: chave });
    expect(ids(foto)).toEqual(["foto", "logo"]);
    expect(foto[0]).toMatchObject({ y: FORMATOS.feed.topo });
    expect(CamposDoAniversario.safeParse({}).success).toBe(false);
  });
});

describe("criarArteComCampos", () => {
  const base = estudioDeTeste();
  let ia: ReturnType<typeof iaDeTeste>;
  const estudio = () => ({ ...base, ia });

  beforeEach(() => {
    ia = iaDeTeste();
  });

  test("grava a arte com as camadas e gera só a cena, que não leva texto da pessoa", async () => {
    const campos = CamposDoConvite.parse(CONVITE);
    const arte = await criarArteComCampos(estudio(), { tipo: "convite", campos, formato: "feed", criadaPor: ana.id });
    expect(textos(arte.camadas)).toMatchObject({ titulo: CONVITE.titulo, data: CONVITE.data, hora: CONVITE.hora, local: CONVITE.local });
    expect(arte.pedido).toBe("Convite: Você é nosso convidado especial, Café da manhã especial, 28 de novembro, A partir das 8h, Imperatriz");
    expect(ia.cenas).toHaveLength(1);
    const lido = [...ia.planos, ...ia.cenas].join("\n");
    for (const segredo of ["28 de novembro", "Imperatriz", "8h", "convidado especial"]) expect(lido).not.toContain(segredo);
    expect(ia.planos[0]).toContain("Café da manhã especial");
    expect(await pegarArte(base.banco, arte.id)).toMatchObject({ id: arte.id });
  });

  test("o texto do título e o logo saem no PNG da arte", async () => {
    const arte = await criarArteComCampos(estudio(), { tipo: "convite", campos: CamposDoConvite.parse(CONVITE), formato: "story", criadaPor: ana.id });
    expect(arte.camadas.some((c) => c.tipo === "logo")).toBe(true);
    expect(arte.formato).toBe("story");
  });

  test("a foto do aniversário vira um PNG redondo e transparente nos cantos, guardado como camada de imagem", async () => {
    const foto = await base.arquivos.salvar(new Uint8Array(await sharp({ create: { width: 900, height: 600, channels: 3, background: "#cc3333" } }).jpeg().toBuffer()), "jpg");
    const arte = await criarArteComCampos(estudio(), { tipo: "aniversario", campos: CamposDoAniversario.parse({ nome: "Ana", foto }), formato: "feed", criadaPor: ana.id });
    const camada = arte.camadas.find((c) => c.tipo === "imagem");
    const chave = camada?.tipo === "imagem" ? camada.chave : "";
    expect(chave).not.toBe(foto);
    const guardada = await base.arquivos.ler(chave);
    const { data, info } = await sharp(guardada!).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alfa = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect([info.width, info.height]).toEqual([800, 800]);
    expect(alfa(2, 2)).toBe(0);
    expect(alfa(400, 400)).toBe(255);
    expect(ia.planos[0]).not.toContain("Ana");
  });

  test("foto que não existe recusa antes de gastar a geração", async () => {
    const foto = `${crypto.randomUUID()}.png`;
    await expect(criarArteComCampos(estudio(), { tipo: "aniversario", campos: CamposDoAniversario.parse({ nome: "Ana", foto }), formato: "feed", criadaPor: ana.id })).rejects.toBeInstanceOf(PedidoInvalido);
    expect(ia.cenas).toHaveLength(0);
  });

  test("apagar devolve a arte e restaurar a traz de volta, uma vez só", async () => {
    const arte = await criarArteComCampos(estudio(), { tipo: "convite", campos: CamposDoConvite.parse(CONVITE), formato: "feed", criadaPor: ana.id });
    const apagada = await apagarArte(base.banco, arte.id);
    expect(apagada).toEqual({ arte });
    expect(await pegarArte(base.banco, arte.id)).toBeNull();
    expect(await apagarArte(base.banco, arte.id)).toBeNull();
    const volta = await restaurarArte(base.banco, arte);
    expect(volta).toEqual(arte);
    await restaurarArte(base.banco, arte);
    expect((await base.banco.select().from(artes)).filter((a) => a.id === arte.id)).toHaveLength(1);
  });

  test("uma arte agendada não se apaga", async () => {
    const arte = await criarArteComCampos(estudio(), { tipo: "convite", campos: CamposDoConvite.parse(CONVITE), formato: "feed", criadaPor: ana.id });
    await q`INSERT INTO queue (arte_id, media_type, publish_at, status, jpeg_path) VALUES (${arte.id}, 'IMAGE', '2031-05-01 03:00:00', 'pending', 'x.jpg')`;
    expect(await apagarArte(base.banco, arte.id)).toMatchObject({ ocupada: expect.stringContaining("agendada") });
    expect(await pegarArte(base.banco, arte.id)).not.toBeNull();
    await q`UPDATE queue SET status = 'cancelled' WHERE arte_id = ${arte.id}`;
    expect(await apagarArte(base.banco, arte.id)).toMatchObject({ arte: { id: arte.id } });
  });
});

describe("as rotas do convite", () => {
  const base = estudioDeTeste();
  let ia: ReturnType<typeof iaDeTeste>;
  let api: ReturnType<typeof criarApi>;
  beforeEach(() => {
    ia = iaDeTeste();
    api = criarApi({ ...base, ia }, async (req) => (req.headers.get("x-teste") === "ana" ? ana : null));
  });
  const pedir = (caminho: string, init: RequestInit = {}) => api.request(`http://localhost${caminho}`, { ...init, headers: { "x-teste": "ana", "content-type": "application/json", ...(init.headers as object) } });
  const post = (corpo: unknown) => pedir("/api/artes", { method: "POST", body: JSON.stringify(corpo) });

  test("POST /api/artes com tipo cria o convite, e o PNG sai com o texto desenhado", async () => {
    const res = await post({ tipo: "convite", formato: "feed", campos: CONVITE });
    expect(res.status).toBe(201);
    const arte = await res.json();
    expect(textos(arte.camadas)).toMatchObject({ titulo: CONVITE.titulo, local: CONVITE.local });
    const png = await pedir(`/api/artes/${arte.id}/png`);
    expect(png.status).toBe(200);
    const { width, height } = await sharp(new Uint8Array(await png.arrayBuffer())).metadata();
    expect([width, height]).toEqual([1080, 1350]);
  });

  test("o editor grava de volta as camadas que o convite e o aniversário criaram", async () => {
    const foto = await base.arquivos.salvar(new Uint8Array(await sharp({ create: { width: 300, height: 300, channels: 3, background: "#336699" } }).png().toBuffer()), "png");
    for (const corpo of [
      { tipo: "convite", formato: "story", campos: { ...CONVITE, observacao: "Confirme presença" } },
      { tipo: "aniversario", formato: "feed", campos: { nome: "Ana", mensagem: "Parabéns", foto } },
    ]) {
      const arte = await (await post(corpo)).json();
      const gravada = await pedir(`/api/artes/${arte.id}`, { method: "PUT", body: JSON.stringify({ camadas: arte.camadas, ajustes: arte.ajustes }) });
      expect(gravada.status).toBe(200);
    }
  });

  test("o pedido em texto livre continua funcionando", async () => {
    const res = await post({ pedido: "Uma arte sobre box temperado", formato: "story" });
    expect(res.status).toBe(201);
    expect(ia.planos).toEqual(["Uma arte sobre box temperado"]);
  });

  test("recusa convite sem campo, tipo desconhecido, formato errado e foto de outra pessoa", async () => {
    expect(await (await post({ tipo: "convite", formato: "feed", campos: { titulo: "  " } })).json()).toEqual({ erro: "Preencha ao menos um campo." });
    expect((await post({ tipo: "casamento", formato: "feed", campos: {} })).status).toBe(400);
    expect((await post({ tipo: "convite", formato: "banner", campos: CONVITE })).status).toBe(400);
    const sumida = await post({ tipo: "aniversario", formato: "feed", campos: { nome: "Ana", foto: `${crypto.randomUUID()}.png` } });
    expect(sumida.status).toBe(400);
    expect((await sumida.json()).erro).toContain("Envie de novo");
    expect(ia.cenas).toHaveLength(0);
  });

  test("apagar, ver que sumiu e desfazer pelo corpo do DELETE", async () => {
    const arte = await (await post({ tipo: "aniversario", formato: "feed", campos: { nome: "Ana", mensagem: "Parabéns" } })).json();
    const apagada = await pedir(`/api/artes/${arte.id}`, { method: "DELETE" });
    expect(apagada.status).toBe(200);
    const corpo = await apagada.json();
    expect((await pedir(`/api/artes/${arte.id}`)).status).toBe(404);

    expect((await pedir(`/api/artes/${arte.id}/restaurar`, { method: "POST", body: JSON.stringify({ ...corpo, id: crypto.randomUUID() }) })).status).toBe(400);
    expect((await pedir(`/api/artes/${arte.id}/restaurar`, { method: "POST", body: JSON.stringify({ ...corpo, cena: "../x.jpg" }) })).status).toBe(400);
    const volta = await pedir(`/api/artes/${arte.id}/restaurar`, { method: "POST", body: JSON.stringify(corpo) });
    expect(volta.status).toBe(200);
    expect(textos((await volta.json()).camadas)).toEqual({ nome: "Ana", mensagem: "Parabéns" });
    expect((await pedir(`/api/artes/${arte.id}`)).status).toBe(200);
    expect((await pedir(`/api/artes/${crypto.randomUUID()}`, { method: "DELETE" })).status).toBe(404);
  });

  test("apagar uma arte agendada devolve 409 e a arte fica", async () => {
    const arte = await (await post({ tipo: "convite", formato: "feed", campos: CONVITE })).json();
    await q`INSERT INTO queue (arte_id, media_type, publish_at, status, jpeg_path) VALUES (${arte.id}, 'IMAGE', '2031-05-01 03:00:00', 'pending', 'x.jpg')`;
    const res = await pedir(`/api/artes/${arte.id}`, { method: "DELETE" });
    expect(res.status).toBe(409);
    expect((await pedir(`/api/artes/${arte.id}`)).status).toBe(200);
  });
});

test("PedidoDeArte lê os dois tipos", () => {
  expect(PedidoDeArte.parse({ tipo: "convite", campos: { evento: "Café" } })).toMatchObject({ tipo: "convite", campos: { evento: "Café", titulo: "" } });
  expect(PedidoDeArte.safeParse({ tipo: "aniversario", campos: { nome: "Ana" } }).success).toBe(true);
});

