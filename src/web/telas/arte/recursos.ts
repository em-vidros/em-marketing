import type { Camada } from "../../../v2/camadas";
import { arquivoDaMarca, chaveDaFonte, FACES_DA_MARCA, urlNoCdn, type FamiliaDoCatalogo, type Peso } from "../../../v2/fontes";

const fontes = new Map<string, Promise<void>>();
const deslocamentos = new Map<string, number>();
const previas = new Set<string>();

/**
 * Carrega um peso de uma família antes de o Leafer desenhar, para ele medir o texto como o render do servidor mede.
 * As da marca vêm do nosso servidor; as outras, do CDN do Fontsource. Uma falha sai do cache para a próxima tentar de novo.
 */
export function carregarFonte(familia: string, peso: Peso): Promise<void> {
  const chave = chaveDaFonte(familia, peso);
  const guardada = fontes.get(chave);
  if (guardada) return guardada;

  const arquivo = arquivoDaMarca(familia, peso);
  const face = new FontFace(familia, `url(${arquivo ? `/fontes/${arquivo}` : urlNoCdn(familia, peso, "woff2")})`, { weight: String(peso) });
  const carga = face.load().then(
    (pronta) => {
      document.fonts.add(pronta);
      deslocamentos.set(chave, medirDeslocamento(familia, peso));
    },
    (erro: unknown) => {
      fontes.delete(chave);
      throw erro;
    },
  );
  fontes.set(chave, carga);

  return carga;
}

/**
 * O Leafer põe a linha de base 0,35 em abaixo do meio da linha, para qualquer fonte; o CSS do render põe no meio da
 * linha mais metade de ascendente menos descendente, que muda de fonte para fonte: Pacifico desce 0,075 em, e Poppins
 * fica igual. Este é o quanto o palco desce o texto, em fração do tamanho, para cair onde o PNG desenha.
 */
export const deslocamentoDaFonte = (familia: string, peso: Peso) => deslocamentos.get(chaveDaFonte(familia, peso)) ?? 0;

/**
 * As fontes da marca e as que as camadas usam. Sem as da marca o editor não abre; uma fonte do catálogo que falha
 * por falta de rede, por exemplo, deixa o texto na fonte de reserva, e o editor abre igual.
 */
export async function carregarFontes(camadas: Camada[]): Promise<void> {
  const doCatalogo = camadas.flatMap((c) => (c.tipo === "texto" && !arquivoDaMarca(c.fonte, c.peso) ? [carregarFonte(c.fonte, c.peso)] : []));
  await Promise.all([Promise.all(FACES_DA_MARCA.map((f) => carregarFonte(f.familia, f.peso))), Promise.allSettled(doCatalogo)]);
}

function medirDeslocamento(familia: string, peso: Peso): number {
  const contexto = document.createElement("canvas").getContext("2d");
  if (!contexto) return 0;

  contexto.font = `${peso} 1000px "${familia}"`;
  const { fontBoundingBoxAscent: ascendente, fontBoundingBoxDescent: descendente } = contexto.measureText("H");

  return ((ascendente - descendente) / 2 - 350) / 1000;
}

/** O nome com que o seletor desenha uma família antes de ela ser escolhida. */
export const familiaDaPrevia = (familia: string) => `Previa ${familia}`;

/**
 * Só as letras do nome da família, pelo `text=` do Google Fonts: poucos KB por linha do seletor, contra dezenas do
 * arquivo inteiro. Fica com outro nome de família para não disputar com a fonte inteira quando ela for escolhida.
 */
export async function carregarPrevia({ familia, pesos }: FamiliaDoCatalogo): Promise<void> {
  if (previas.has(familia)) return;
  previas.add(familia);

  const peso = pesos.includes(400) ? 400 : pesos[0];
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(familia)}:wght@${peso}&text=${encodeURIComponent(familia)}`).then((r) => (r.ok ? r.text() : ""));
  const url = /url\((https:[^)]+)\)/.exec(css)?.[1];
  if (!url) return;

  document.fonts.add(await new FontFace(familiaDaPrevia(familia), `url(${url})`).load());
}

export async function carregarImagem(chave: string): Promise<HTMLImageElement> {
  const imagem = new Image();
  imagem.src = `/api/arquivos/${chave}`;
  await imagem.decode();

  return imagem;
}
