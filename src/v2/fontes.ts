/**
 * As fontes da marca, com o arquivo local de cada peso. Abrem sem rede no editor e no PNG; qualquer outra família
 * ou peso vem do catálogo do Google Fonts, pelo Fontsource.
 */
export const FACES_DA_MARCA: { familia: string; peso: Peso; arquivo: string }[] = [
  { familia: "Poppins", peso: 400, arquivo: "Poppins-Regular.ttf" },
  { familia: "Poppins", peso: 500, arquivo: "Poppins-Medium.ttf" },
  { familia: "Poppins", peso: 600, arquivo: "Poppins-SemiBold.ttf" },
  { familia: "Playfair Display", peso: 500, arquivo: "PlayfairDisplay-Variable.ttf" },
];

export const PESOS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;
export type Peso = (typeof PESOS)[number];

export const NOME_DO_PESO: Record<Peso, string> = {
  100: "Fino",
  200: "Extraleve",
  300: "Leve",
  400: "Regular",
  500: "Médio",
  600: "Seminegrito",
  700: "Negrito",
  800: "Extranegrito",
  900: "Ultranegrito",
};

export const CATEGORIAS = { "sans-serif": "Sem serifa", serif: "Serifa", display: "Display", handwriting: "Manuscrita", monospace: "Mono" } as const;
export type Categoria = keyof typeof CATEGORIAS;

export type FamiliaDoCatalogo = { familia: string; pesos: Peso[]; categoria: Categoria };

/** Só letras, números e espaços simples: é o que os nomes do catálogo usam, e o nome vai para URL e CSS. */
export const NOME_DE_FAMILIA = /^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/;

/** As fontes da marca como o seletor as mostra quando o catálogo não carrega: só os pesos que existem em arquivo. */
export const FAMILIAS_DA_MARCA: FamiliaDoCatalogo[] = [
  { familia: "Poppins", pesos: [400, 500, 600], categoria: "sans-serif" },
  { familia: "Playfair Display", pesos: [500], categoria: "serif" },
];

export const chaveDaFonte = (familia: string, peso: Peso) => `${familia} ${peso}`;

const ARQUIVOS_DA_MARCA = new Map(FACES_DA_MARCA.map((f) => [chaveDaFonte(f.familia, f.peso), f.arquivo]));

/** O arquivo local de uma fonte da marca, ou null quando a família ou o peso só existem no catálogo. */
export const arquivoDaMarca = (familia: string, peso: Peso) => ARQUIVOS_DA_MARCA.get(chaveDaFonte(familia, peso)) ?? null;

/**
 * O arquivo de um peso no CDN do Fontsource. O id do Fontsource é o nome em minúsculas com hífens, o que vale para
 * todas as famílias do Google. O subset latin vai até U+00FF, então já tem á, ç, ã e õ.
 */
export const urlNoCdn = (familia: string, peso: Peso, extensao: "ttf" | "woff2") =>
  `https://cdn.jsdelivr.net/fontsource/fonts/${familia.toLowerCase().replaceAll(" ", "-")}@latest/latin-${peso}-normal.${extensao}`;

/** O peso que fica quando a família muda: o mesmo se ela tiver, senão o mais perto. */
export function pesoMaisPerto(pesos: Peso[], desejado: Peso): Peso {
  return pesos.reduce((melhor, peso) => (Math.abs(peso - desejado) < Math.abs(melhor - desejado) ? peso : melhor), pesos[0] ?? desejado);
}
