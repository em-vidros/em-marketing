import { DragDropVerticalIcon, SquareLock02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import type { Camada } from "../../../v2/camadas";
import { descricaoDa, TIPO } from "./textos";

type Arraste = { de: number; sobre: number } | null;

/**
 * As camadas da frente para trás, como no Canva: a de cima da lista é a que fica por cima na arte. Arrastar uma
 * linha muda a ordem; pelo teclado, a ordem muda pelo painel Posição.
 */
export function ListaDeCamadas(props: { camadas: Camada[]; selecionada: string | null; selecionar: (id: string) => void; reordenar: (de: number, para: number) => void }) {
  const [arraste, setArraste] = useState<Arraste>(null);
  const ultimo = props.camadas.length - 1;
  const linhas = props.camadas.map((camada, indice) => ({ camada, indice })).reverse();

  if (linhas.length === 0) return <p className="text-sm text-tinta-3">A arte ainda não tem camadas. Acrescente um texto, um elemento ou uma imagem pelas abas ao lado.</p>;

  return (
    <ul aria-label="Camadas, da frente para trás" className="flex flex-col gap-1">
      {linhas.map(({ camada: c, indice }) => {
        const alvo = arraste && arraste.sobre === indice && arraste.de !== indice;
        return (
          <li
            key={c.id}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = "move";
              setArraste({ de: indice, sobre: indice });
            }}
            onDragOver={(e) => {
              if (!arraste) return;
              e.preventDefault();
              if (arraste.sobre !== indice) setArraste({ ...arraste, sobre: indice });
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (arraste) props.reordenar(arraste.de, indice);
              setArraste(null);
            }}
            onDragEnd={() => setArraste(null)}
            className={`relative rounded-item ${arraste?.de === indice ? "opacity-40" : ""}`}
          >
            {alvo && <span aria-hidden="true" className={`absolute right-1 left-1 h-0.5 rounded-full bg-[#2F646A] ${arraste.de < indice ? "-top-0.5" : "-bottom-0.5"}`} />}
            <button
              type="button"
              aria-pressed={c.id === props.selecionada}
              aria-label={`${TIPO[c.tipo]}: ${descricaoDa(c)}${c.bloqueada ? ", travada" : ""}. Posição ${ultimo - indice + 1} de ${ultimo + 1}`}
              onClick={() => props.selecionar(c.id)}
              className="flex w-full cursor-pointer items-center gap-2 rounded-item px-2 py-2 text-left text-sm hover:bg-hover aria-pressed:bg-ativo"
            >
              <HugeiconsIcon icon={DragDropVerticalIcon} size={16} strokeWidth={1.6} className="flex-none cursor-grab text-tinta-4" />
              <Miniatura camada={c} />
              <span className="min-w-0 flex-1 truncate">{descricaoDa(c)}</span>
              {c.bloqueada && <HugeiconsIcon icon={SquareLock02Icon} size={15} strokeWidth={1.6} className="flex-none text-tinta-3" />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Miniatura({ camada: c }: { camada: Camada }) {
  const caixa = "grid size-9 flex-none place-items-center overflow-hidden rounded-lg border border-linha bg-[#F0EFEA]";
  switch (c.tipo) {
    case "texto":
      return (
        <span aria-hidden="true" className={`${caixa} text-[15px] font-semibold`} style={{ color: c.cor, fontFamily: c.fonte }}>
          Aa
        </span>
      );
    case "forma":
      return <span aria-hidden="true" className={caixa} style={{ backgroundColor: c.cor }} />;
    case "logo":
      return (
        <span aria-hidden="true" className={caixa} style={{ backgroundColor: c.variante === "branca" ? "#2F646A" : undefined }}>
          <img src={c.variante === "branca" ? "/logo/emvidros-branca.svg" : "/logo/emvidros-oficial.svg"} alt="" className="w-6" />
        </span>
      );
    case "imagem":
      return (
        <span aria-hidden="true" className={caixa}>
          <img src={`/api/arquivos/${c.chave}`} alt="" className="max-h-full max-w-full object-contain" />
        </span>
      );
  }
}
