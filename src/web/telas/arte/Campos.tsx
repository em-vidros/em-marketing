import { useEffect, useId, useState, type ReactNode } from "react";

/** As cores do brandbook (tokens.json, `color`), com o nome que o manual dá a cada uma. */
const PALETA = [
  { hex: "#2F646A", nome: "Teal profundo" },
  { hex: "#63B5AF", nome: "Teal claro" },
  { hex: "#414141", nome: "Grafite" },
  { hex: "#FFFFFF", nome: "Branco" },
  { hex: "#F0EFEA", nome: "Off-white" },
  { hex: "#E4E1D8", nome: "Areia" },
  { hex: "#D8D5CE", nome: "Linha" },
  { hex: "#8A8A8A", nome: "Cinza médio" },
];

export function Campo({ rotulo, children }: { rotulo: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs text-tinta-3">
        {rotulo}
      </label>
      {children(id)}
    </div>
  );
}

/** Campo numérico com rascunho: aceita digitar "1" a caminho de "150" e volta ao último valor válido ao sair. */
export function Numero(props: { rotulo: string; valor: number; min: number; max: number; passo?: number; aoMudar: (v: number) => void }) {
  const [rascunho, setRascunho] = useState(String(props.valor));
  useEffect(() => setRascunho(String(props.valor)), [props.valor]);
  return (
    <Campo rotulo={props.rotulo}>
      {(id) => (
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={rascunho}
          min={props.min}
          max={props.max}
          step={props.passo ?? 1}
          onChange={(e) => {
            setRascunho(e.target.value);
            const v = e.target.valueAsNumber;
            if (Number.isFinite(v) && v >= props.min && v <= props.max) props.aoMudar(props.passo ? v : Math.round(v));
          }}
          onBlur={() => setRascunho(String(props.valor))}
          className="w-full min-w-0 rounded-item border border-borda-campo bg-transparent px-2.5 py-2 text-sm tabular"
        />
      )}
    </Campo>
  );
}

export function Cor({ valor, aoMudar }: { valor: string; aoMudar: (cor: string) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-xs text-tinta-3">Cor</legend>
      <div className="flex flex-wrap items-center gap-1.5">
        {PALETA.map(({ hex, nome }) => (
          <button
            key={hex}
            type="button"
            title={nome}
            aria-label={nome}
            aria-pressed={valor.toUpperCase() === hex}
            onClick={() => aoMudar(hex)}
            className="size-7 cursor-pointer rounded-full outline-1 -outline-offset-1 outline-[rgb(0_0_0/0.18)] aria-pressed:outline-2 aria-pressed:outline-offset-2 aria-pressed:outline-tinta"
            style={{ backgroundColor: hex }}
          />
        ))}
        <label className="ml-1 flex cursor-pointer items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-tinta-2 hover:bg-hover">
          <input
            type="color"
            aria-label="Cor personalizada"
            value={valor.toLowerCase()}
            onChange={(e) => aoMudar(e.target.value.toUpperCase())}
            className="size-5 cursor-pointer rounded-full border-0 bg-transparent p-0"
          />
          <span className="font-mono tabular">{valor.toUpperCase()}</span>
        </label>
      </div>
    </fieldset>
  );
}

export function Deslizante(props: { rotulo: string; valor: number; min: number; max: number; passo: number; formatar: (v: number) => string; aoMudar: (v: number) => void }) {
  return (
    <Campo rotulo={props.rotulo}>
      {(id) => (
        <div className="flex items-center gap-2.5">
          <input
            id={id}
            type="range"
            min={props.min}
            max={props.max}
            step={props.passo}
            value={props.valor}
            onChange={(e) => props.aoMudar(e.target.valueAsNumber)}
            className="min-w-0 flex-1 cursor-pointer accent-[#2F646A]"
          />
          <output htmlFor={id} className="w-12 flex-none text-right text-[13px] text-tinta-2 tabular">
            {props.formatar(props.valor)}
          </output>
        </div>
      )}
    </Campo>
  );
}
