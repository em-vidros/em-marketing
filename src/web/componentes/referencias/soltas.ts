import { useEffect, useRef, useState } from "react";

export const imagensDe = (lista: FileList | null | undefined) => [...(lista ?? [])].filter((f) => f.type.startsWith("image/"));
const temArquivo = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;

/**
 * Colar (⌘V) e soltar imagens valem na tela inteira, para não exigir mirar numa caixa. Devolve se há um arquivo sendo
 * arrastado sobre a janela, para a tela mostrar onde soltar. Desligado, a janela não escuta nada.
 */
export function useImagensSoltas(receber: (arquivos: File[]) => void, ligado = true): boolean {
  const [soltando, setSoltando] = useState(false);
  const receberAtual = useRef(receber);
  receberAtual.current = receber;

  useEffect(() => {
    if (!ligado) return;
    // dragenter e dragleave disparam a cada filho cruzado: a profundidade diz se o arquivo ainda está na janela.
    let profundidade = 0;
    // Arquivo que não é imagem também passa, colado ou solto: quem recebe avisa por que ele não entrou.
    const colar = (e: ClipboardEvent) => {
      const arquivos = [...(e.clipboardData?.files ?? [])];
      if (!arquivos.length) return;
      e.preventDefault();
      receberAtual.current(arquivos);
    };
    const entrar = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      profundidade++;
      setSoltando(true);
    };
    const sair = () => {
      profundidade = Math.max(0, profundidade - 1);
      if (!profundidade) setSoltando(false);
    };
    const sobre = (e: DragEvent) => {
      if (temArquivo(e)) e.preventDefault();
    };
    const soltar = (e: DragEvent) => {
      if (!temArquivo(e)) return;
      e.preventDefault();
      profundidade = 0;
      setSoltando(false);
      receberAtual.current([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("paste", colar);
    window.addEventListener("dragenter", entrar);
    window.addEventListener("dragleave", sair);
    window.addEventListener("dragover", sobre);
    window.addEventListener("drop", soltar);
    return () => {
      setSoltando(false);
      window.removeEventListener("paste", colar);
      window.removeEventListener("dragenter", entrar);
      window.removeEventListener("dragleave", sair);
      window.removeEventListener("dragover", sobre);
      window.removeEventListener("drop", soltar);
    };
  }, [ligado]);

  return soltando;
}
