import { FONTES } from "../../../v2/camadas";

let fontes: Promise<void> | null = null;

/** As fontes da marca no navegador, para o Leafer medir o texto como o render do servidor mede. */
export function carregarFontes(): Promise<void> {
  fontes ??= Promise.all(
    Object.entries(FONTES).flatMap(([familia, pesos]) =>
      Object.entries(pesos).map(([peso, arquivo]) => {
        const face = new FontFace(familia, `url(/fontes/${arquivo})`, { weight: peso });
        document.fonts.add(face);
        return face.load();
      }),
    ),
  ).then(
    () => undefined,
    (erro: unknown) => {
      fontes = null;
      throw erro;
    },
  );
  return fontes;
}

export async function carregarImagem(chave: string): Promise<HTMLImageElement> {
  const imagem = new Image();
  imagem.src = `/api/arquivos/${chave}`;
  await imagem.decode();

  return imagem;
}
