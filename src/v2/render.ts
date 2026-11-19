import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";
import { AJUSTES_NEUTROS, FORMATOS, PROPORCAO_DO_LOGO, recorteDaCena, transformacaoDa, type Ajustes, type Camada } from "./camadas";
import { arquivoDaMarca, chaveDaFonte, FACES_DA_MARCA, type Peso } from "./fontes";
import { bytesDaFonte } from "./fontsource";
import type { Arte } from "./schema";

type No = { type: string; props: Record<string, unknown> };
type FonteDoSatori = { name: string; weight: Peso; style: "normal"; data: ArrayBuffer };

const pastaDaMarca = `${process.cwd()}/brand/assets/`;

const fontesDaMarca: FonteDoSatori[] = await Promise.all(
  FACES_DA_MARCA.map(async ({ familia, peso, arquivo }) => ({ name: familia, weight: peso, style: "normal", data: await Bun.file(`${pastaDaMarca}fonts/${arquivo}`).arrayBuffer() })),
);

const dataUri = (tipo: string, bytes: Uint8Array) => `data:${tipo};base64,${Buffer.from(bytes).toString("base64")}`;

const logos = {
  cor: dataUri("image/svg+xml", await Bun.file(`${pastaDaMarca}logo/emvidros-oficial.svg`).bytes()),
  branca: dataUri("image/svg+xml", await Bun.file(`${pastaDaMarca}logo/emvidros-branca.svg`).bytes()),
};

const ALINHAMENTO = {
  esquerda: { textAlign: "left", justifyContent: "flex-start" },
  centro: { textAlign: "center", justifyContent: "center" },
  direita: { textAlign: "right", justifyContent: "flex-end" },
} as const;

/** Lê o arquivo de uma camada de imagem. Vem de fora para o render não depender do Blob. */
export type LerArquivo = (chave: string) => Promise<Uint8Array | null>;

export type Desenho = Pick<Arte, "formato" | "camadas" | "ajustes">;

function noDaCamada(camada: Camada, imagens: Map<string, string>): No {
  const { rotacao, opacidade } = transformacaoDa(camada);
  const lugar = {
    position: "absolute",
    left: camada.x,
    top: camada.y,
    width: camada.largura,
    ...(rotacao !== 0 && { transform: `rotate(${rotacao}deg)` }),
    ...(opacidade !== 1 && { opacity: opacidade }),
  };
  switch (camada.tipo) {
    case "texto":
      return {
        type: "div",
        props: {
          style: {
            ...lugar,
            display: "flex",
            fontFamily: camada.fonte,
            fontWeight: camada.peso,
            fontSize: camada.tamanho,
            lineHeight: camada.entrelinha,
            color: camada.cor,
            ...ALINHAMENTO[camada.alinhamento],
          },
          children: camada.texto,
        },
      };
    case "logo":
      return { type: "img", props: { src: logos[camada.variante], width: camada.largura, height: Math.round(camada.largura * PROPORCAO_DO_LOGO), style: lugar } };
    case "imagem": {
      const src = imagens.get(camada.chave);
      const altura = Math.round(camada.largura * camada.proporcao);
      return src ? { type: "img", props: { src, width: camada.largura, height: altura, style: lugar } } : { type: "div", props: { style: { ...lugar, height: altura } } };
    }
    case "forma":
      return { type: "div", props: { style: { ...lugar, height: camada.altura, backgroundColor: camada.cor, borderRadius: camada.raio } } };
  }
}

/** A arte pronta para baixar: a cena tratada no fundo e as camadas por cima, na ordem do array. */
export async function renderizar({ formato, camadas: pedidas, ajustes }: Desenho, cena: Uint8Array, ler?: LerArquivo): Promise<Uint8Array<ArrayBuffer>> {
  const { largura, altura } = FORMATOS[formato];
  const [fundo, { fontes, camadas }] = await Promise.all([tratarCena(cena, ajustes, largura, altura), fontesDoCatalogo(pedidas)]);

  const imagens = new Map<string, string>();
  for (const c of camadas)
    if (c.tipo === "imagem" && ler && !imagens.has(c.chave)) {
      const bytes = await ler(c.chave);
      if (bytes) imagens.set(c.chave, dataUri(c.chave.endsWith(".jpg") ? "image/jpeg" : c.chave.endsWith(".webp") ? "image/webp" : "image/png", bytes));
    }
  const raiz: No = {
    type: "div",
    props: {
      style: { width: largura, height: altura, display: "flex", position: "relative", backgroundColor: "#F0EFEA" },
      children: [
        { type: "img", props: { src: dataUri("image/jpeg", fundo), width: largura, height: altura, style: { position: "absolute", left: 0, top: 0 } } },
        ...camadas.map((c) => noDaCamada(c, imagens)),
      ],
    },
  };
  const svg = await satori(raiz as Parameters<typeof satori>[0], { width: largura, height: altura, fonts: [...fontesDaMarca, ...fontes] });
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: false } }).render().asPng());
}

/**
 * Baixa as fontes do catálogo que as camadas usam. Uma fonte que não baixa não derruba o PNG: o texto dela sai em
 * Poppins, no peso mais perto que a marca tem.
 */
async function fontesDoCatalogo(camadas: Camada[]): Promise<{ fontes: FonteDoSatori[]; camadas: Camada[] }> {
  const doCatalogo = new Map(
    camadas.flatMap((c) => (c.tipo === "texto" && !arquivoDaMarca(c.fonte, c.peso) ? [[chaveDaFonte(c.fonte, c.peso), { familia: c.fonte, peso: c.peso }] as const] : [])),
  );
  const baixadas = await Promise.allSettled([...doCatalogo.values()].map(async ({ familia, peso }) => ({ name: familia, weight: peso, style: "normal" as const, data: await bytesDaFonte(familia, peso) })));
  const fontes = baixadas.flatMap((b) => (b.status === "fulfilled" ? [b.value] : []));
  const faltam = new Set([...doCatalogo.keys()].filter((_, i) => baixadas[i]?.status === "rejected"));
  if (faltam.size === 0) return { fontes, camadas };

  console.error("render: fontes do catálogo que não baixaram, o texto sai em Poppins", [...faltam], baixadas.flatMap((b) => (b.status === "rejected" ? [b.reason] : [])));
  const trocadas = camadas.map((c) => (c.tipo === "texto" && faltam.has(chaveDaFonte(c.fonte, c.peso)) ? { ...c, fonte: "Poppins" } : c));

  return { fontes, camadas: trocadas };
}

/**
 * A arte como o Instagram aceita: JPEG em sRGB. O limite da API é 8 MB, e nem o maior formato chega
 * perto: 1080×1920 em RGB cru já são 6,2 MB, e o JPEG fica bem abaixo disso.
 */
export async function renderizarJpeg(desenho: Desenho, cena: Uint8Array, ler?: LerArquivo): Promise<Uint8Array> {
  const png = await renderizar(desenho, cena, ler);
  return new Uint8Array(await sharp(png).toColorspace("srgb").jpeg({ quality: 90, mozjpeg: true }).toBuffer());
}

type Imagem = ReturnType<typeof sharp>;
type Passo = (imagem: Imagem) => Imagem;

/**
 * Enquadra a cena e aplica os ajustes como os filtros CSS que o editor usa no navegador (brightness, contrast,
 * saturate, blur, nessa ordem), um passo por vez: o CSS corta cada filtro em 0..255 antes do próximo, e cada passo do
 * sharp também.
 */
async function tratarCena(cena: Uint8Array, ajustes: Ajustes, largura: number, altura: number): Promise<Uint8Array> {
  const enquadrada = ajustes.zoom !== AJUSTES_NEUTROS.zoom;
  const passos = passosDosAjustes(ajustes);
  if (!enquadrada && passos.length === 0) return cena;

  const original = await sharp(cena).metadata();
  const recorte = recorteDaCena(ajustes, original.width ?? largura, original.height ?? altura);
  const enquadrar: Passo = (imagem) => imagem.flatten({ background: "#F0EFEA" }).extract(recorte).resize(largura, altura, { fit: "fill" });
  let bytes = Buffer.from(cena);
  let raw: { width: number; height: number; channels: 1 | 2 | 3 | 4 } | undefined;
  for (const passo of [enquadrar, ...passos]) {
    const { data, info } = await passo(sharp(bytes, raw && { raw })).raw().toBuffer({ resolveWithObject: true });
    bytes = data;
    raw = { width: info.width, height: info.height, channels: info.channels };
  }

  return new Uint8Array(await sharp(bytes, { raw }).jpeg({ quality: 95 }).toBuffer());
}

function passosDosAjustes({ brilho, contraste, saturacao, desfoque }: Ajustes): Passo[] {
  const passos: Passo[] = [];
  if (brilho !== 1) passos.push((imagem) => imagem.linear(brilho, 0));
  if (contraste !== 1) passos.push((imagem) => imagem.linear(contraste, 127.5 * (1 - contraste)));
  if (saturacao !== 1) passos.push((imagem) => imagem.recomb(matrizDeSaturacao(saturacao)));
  if (desfoque > 0) passos.push((imagem) => imagem.blur(Math.max(0.3, desfoque)));

  return passos;
}

/** A matriz do saturate() do CSS (feColorMatrix type="saturate"). */
function matrizDeSaturacao(s: number): Parameters<Imagem["recomb"]>[0] {
  return [
    [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
    [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
  ];
}
