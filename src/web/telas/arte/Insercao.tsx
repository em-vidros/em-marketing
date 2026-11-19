import { useState, type DragEvent } from "react";
import { FORMATOS, PROPORCAO_DO_LOGO, type Camada, type Formato } from "../../../v2/camadas";
import { apiArtes } from "../../api";
import { novoElemento, novoId, novoTexto, type ElementoNovo, type PresetDeTexto } from "./operacoes";

interface PropsDeInsercao {
  formato: Formato;
  camadas: Camada[];
  cheia: boolean;
  acrescentar: (camada: Camada) => void;
}

const AVISO_DE_CHEIA = "A arte já tem 30 camadas, o máximo. Apague uma para acrescentar outra.";

const TILE = "pressiona cursor-pointer overflow-hidden rounded-item border border-linha bg-painel text-left hover:border-linha-forte hover:bg-hover disabled:cursor-default disabled:opacity-50";

export function PainelElementos({ formato, cheia, acrescentar }: PropsDeInsercao) {
  const colocar = (elemento: ElementoNovo) => acrescentar(novoElemento(formato, elemento));

  return (
    <>
      {cheia && <AvisoDeCheia />}
      <section className="flex flex-col gap-2">
        <h3 className="text-xs text-tinta-3">Formas</h3>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={cheia} onClick={() => colocar("faixa")} className={`${TILE} flex aspect-square flex-col justify-end`}>
            <span className="sr-only">Faixa na base da arte</span>
            <span aria-hidden="true" className="h-1/3 w-full bg-[#2F646A]" />
          </button>
          <button type="button" disabled={cheia} onClick={() => colocar("retangulo")} className={`${TILE} grid aspect-square place-items-center`}>
            <span className="sr-only">Quadrado</span>
            <span aria-hidden="true" className="size-1/2 rounded-md bg-[#63B5AF]" />
          </button>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs text-tinta-3">Logo oficial</h3>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" disabled={cheia} onClick={() => colocar("logo-cor")} className={`${TILE} grid aspect-square place-items-center bg-[#F0EFEA]`}>
            <img src="/logo/emvidros-oficial.svg" alt="Logo colorido" className="w-3/5" style={{ aspectRatio: `1 / ${PROPORCAO_DO_LOGO}` }} />
          </button>
          <button type="button" disabled={cheia} onClick={() => colocar("logo-branca")} className={`${TILE} grid aspect-square place-items-center bg-[#2F646A]`}>
            <img src="/logo/emvidros-branca.svg" alt="Logo branco" className="w-3/5" style={{ aspectRatio: `1 / ${PROPORCAO_DO_LOGO}` }} />
          </button>
        </div>
      </section>
    </>
  );
}

const PRESETS: { preset: PresetDeTexto; rotulo: string; classe: string }[] = [
  { preset: "titulo", rotulo: "Adicionar um título", classe: "font-[Poppins] text-[22px] font-semibold text-[#2F646A]" },
  { preset: "subtitulo", rotulo: "Adicionar um subtítulo", classe: "font-[Poppins] text-base font-medium text-[#414141]" },
  { preset: "corpo", rotulo: "Adicionar um pouco de texto", classe: "font-[Poppins] text-[13px] text-[#414141]" },
  { preset: "display", rotulo: "Título de destaque", classe: "font-['Playfair_Display'] text-2xl font-medium text-[#2F646A]" },
];

export function PainelTexto({ formato, cheia, acrescentar }: PropsDeInsercao) {
  return (
    <>
      {cheia && <AvisoDeCheia />}
      <button
        type="button"
        disabled={cheia}
        onClick={() => acrescentar(novoTexto(formato, "corpo"))}
        className="pressiona h-10 cursor-pointer rounded-full bg-tinta text-sm font-medium text-sobre-tinta disabled:cursor-default disabled:opacity-50"
      >
        Adicionar uma caixa de texto
      </button>
      <section className="flex flex-col gap-2">
        <h3 className="text-xs text-tinta-3">Estilos da marca</h3>
        {PRESETS.map(({ preset, rotulo, classe }) => (
          <button key={preset} type="button" disabled={cheia} onClick={() => acrescentar(novoTexto(formato, preset))} className={`${TILE} px-4 py-3`}>
            <span className={classe}>{rotulo}</span>
          </button>
        ))}
      </section>
    </>
  );
}

type Envio = { tipo: "parado" } | { tipo: "enviando" } | { tipo: "erro"; mensagem: string };

export function PainelUploads({ arteId, formato, camadas, cheia, acrescentar }: PropsDeInsercao & { arteId: string }) {
  const [envio, setEnvio] = useState<Envio>({ tipo: "parado" });
  const [sobre, setSobre] = useState(false);
  const enviadas = [...new Map(camadas.flatMap((c) => (c.tipo === "imagem" ? [[c.chave, c] as const] : []))).values()];
  const bloqueado = cheia || envio.tipo === "enviando";

  async function enviar(arquivo: File | undefined) {
    if (!arquivo || bloqueado) return;
    setEnvio({ tipo: "enviando" });
    try {
      const { chave, proporcao } = await apiArtes.enviarImagem(arteId, arquivo);
      acrescentar(imagemCentrada(formato, chave, proporcao));
      setEnvio({ tipo: "parado" });
    } catch (e) {
      setEnvio({ tipo: "erro", mensagem: (e as Error).message });
    }
  }

  function aoSoltar(e: DragEvent) {
    e.preventDefault();
    setSobre(false);
    void enviar(e.dataTransfer.files[0]);
  }

  return (
    <>
      {cheia && <AvisoDeCheia />}
      <label
        onDragOver={(e) => (e.preventDefault(), setSobre(true))}
        onDragLeave={() => setSobre(false)}
        onDrop={aoSoltar}
        className={`flex cursor-pointer flex-col items-center gap-1 rounded-item border border-dashed px-4 py-7 text-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-tinta ${
          sobre ? "border-tinta bg-ativo" : "border-borda-campo hover:bg-hover"
        } ${bloqueado ? "pointer-events-none opacity-50" : ""}`}
      >
        <span className="text-sm font-medium">{envio.tipo === "enviando" ? "Enviando…" : "Enviar imagem ou SVG"}</span>
        <span className="text-[13px] text-tinta-3">PNG, JPG, WebP ou SVG. Clique ou arraste o arquivo para cá.</span>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
          className="sr-only"
          disabled={bloqueado}
          onChange={(e) => {
            void enviar(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {envio.tipo === "erro" && (
        <p role="alert" className="text-[13px] text-erro">
          Não deu para enviar a imagem: {envio.mensagem}
        </p>
      )}
      {enviadas.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs text-tinta-3">Nesta arte</h3>
          <div className="grid grid-cols-3 gap-2">
            {enviadas.map((c) => (
              <button key={c.chave} type="button" disabled={cheia} onClick={() => acrescentar(imagemCentrada(formato, c.chave, c.proporcao))} className={`${TILE} grid aspect-square place-items-center p-2`}>
                <img src={`/api/arquivos/${c.chave}`} alt="Usar esta imagem de novo" className="max-h-full max-w-full object-contain" />
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function imagemCentrada(formato: Formato, chave: string, proporcao: number): Camada {
  const { largura, altura } = FORMATOS[formato];
  const larguraDaImagem = Math.round(Math.min(largura * 0.4, (altura * 0.6) / proporcao));
  return {
    id: novoId(),
    tipo: "imagem",
    chave,
    proporcao,
    largura: larguraDaImagem,
    x: Math.round((largura - larguraDaImagem) / 2),
    y: Math.round((altura - larguraDaImagem * proporcao) / 2),
  };
}

const AvisoDeCheia = () => <p className="rounded-item bg-painel px-3 py-2.5 text-[13px] text-tinta-2">{AVISO_DE_CHEIA}</p>;
