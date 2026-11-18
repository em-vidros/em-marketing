import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";
import { FONTES, FORMATOS, PROPORCAO_DO_LOGO, type Camada, type Formato } from "./camadas";

type No = { type: string; props: Record<string, unknown> };

const pastaDaMarca = new URL("../../brand/assets/", import.meta.url).pathname;

const fontes = await Promise.all(
  Object.entries(FONTES).flatMap(([familia, pesos]) =>
    Object.entries(pesos).map(async ([peso, arquivo]) => ({
      name: familia,
      weight: Number(peso) as 400 | 500 | 600,
      style: "normal" as const,
      data: await Bun.file(`${pastaDaMarca}fonts/${arquivo}`).arrayBuffer(),
    })),
  ),
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

function noDaCamada(camada: Camada): No {
  const lugar = { position: "absolute", left: camada.x, top: camada.y, width: camada.largura };
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
    case "forma":
      return { type: "div", props: { style: { ...lugar, height: camada.altura, backgroundColor: camada.cor, borderRadius: camada.raio } } };
  }
}

/** A arte pronta para baixar: a cena no fundo e as camadas por cima, na ordem do array. */
export async function renderizar(formato: Formato, cena: Uint8Array, camadas: Camada[]): Promise<Uint8Array<ArrayBuffer>> {
  const { largura, altura } = FORMATOS[formato];
  const raiz: No = {
    type: "div",
    props: {
      style: { width: largura, height: altura, display: "flex", position: "relative", backgroundColor: "#F0EFEA" },
      children: [
        { type: "img", props: { src: dataUri("image/jpeg", cena), width: largura, height: altura, style: { position: "absolute", left: 0, top: 0 } } },
        ...camadas.map(noDaCamada),
      ],
    },
  };
  const svg = await satori(raiz as Parameters<typeof satori>[0], { width: largura, height: altura, fonts: fontes });
  return new Uint8Array(new Resvg(svg, { fitTo: { mode: "original" }, font: { loadSystemFonts: false } }).render().asPng());
}

/**
 * A arte como o Instagram aceita: JPEG em sRGB. O limite da API é 8 MB, e nem o maior formato chega
 * perto: 1080×1920 em RGB cru já são 6,2 MB, e o JPEG fica bem abaixo disso.
 */
export async function renderizarJpeg(formato: Formato, cena: Uint8Array, camadas: Camada[]): Promise<Uint8Array> {
  const png = await renderizar(formato, cena, camadas);
  return new Uint8Array(await sharp(png).toColorspace("srgb").jpeg({ quality: 90, mozjpeg: true }).toBuffer());
}
