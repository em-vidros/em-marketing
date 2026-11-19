import { useEffect, useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@ui-sdk/react/combobox";
import type { Modelo } from "../../../agent/models";
import type { Carga } from "../../api";
import { Falha } from "../Falha";

/** Os campos da config de um bot, usados na aba Configuração e na tela de criar bot. */

export const conta = (n: number) => n.toLocaleString("pt-BR");

export const estiloCampo =
  "w-full rounded-[10px] border border-borda-campo bg-superficie px-3 py-2 text-base text-tinta transition-[border-color] duration-150 hover:border-tinta-3 focus-visible:border-tinta sm:text-sm aria-invalid:border-erro";

export function Linha({ rotulo, para, ajuda, children }: { rotulo: string; para?: string; ajuda?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-x-10 gap-y-2.5 border-t border-linha px-5 py-5 first:border-t-0 md:grid-cols-[minmax(0,200px)_minmax(0,1fr)]">
      <div className="flex flex-col gap-1">
        {para ? (
          <label htmlFor={para} className="font-medium">
            {rotulo}
          </label>
        ) : (
          <span className="font-medium">{rotulo}</span>
        )}
        {ajuda && <p className="text-[13px] text-pretty text-tinta-3">{ajuda}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">{children}</div>
    </div>
  );
}

export function Problema({ id, texto }: { id: string; texto: string | undefined }) {
  return texto ? (
    <p id={id} className="text-[13px] text-erro">
      {texto}
    </p>
  ) : null;
}

export const Cartao = ({ children, titulo }: { children: ReactNode; titulo?: string }) => (
  <section aria-label={titulo} className="flex flex-col gap-2.5">
    {titulo && <h2 className="px-1 text-[13px] font-medium text-tinta-3">{titulo}</h2>}
    <div className="rounded-cartao bg-superficie shadow-[0_0_0_1px_var(--color-linha-forte)]">{children}</div>
  </section>
);

/** Cresce com o texto. Altura não anima: muda a cada tecla. */
export function useAutoAltura(valor: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [valor]);
  return ref;
}

/** Uma frase, mas pode passar de uma linha: cresce em vez de esconder o fim. Enter não quebra linha. */
export function Descricao({
  id,
  valor,
  aoMudar,
  campoRef,
  placeholder,
  invalido,
  descrito,
}: {
  id: string;
  valor: string;
  aoMudar: (v: string) => void;
  campoRef: (el: HTMLTextAreaElement | null) => void;
  placeholder: string;
  invalido: boolean;
  descrito: string | undefined;
}) {
  const ref = useAutoAltura(valor);
  return (
    <textarea
      id={id}
      ref={(el) => {
        ref.current = el;
        campoRef(el);
      }}
      rows={1}
      value={valor}
      onChange={(e) => aoMudar(e.target.value.replace(/\n/g, " "))}
      onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
      placeholder={placeholder}
      aria-invalid={invalido || undefined}
      aria-describedby={descrito}
      className={`${estiloCampo} resize-none overflow-hidden`}
    />
  );
}

export function SeletorDeModelo({
  valor,
  salvo,
  modelos,
  aoMudar,
  relerModelos,
}: {
  valor: string;
  salvo: string;
  modelos: Carga<Modelo[]>;
  aoMudar: (id: string) => void;
  relerModelos: () => void;
}) {
  const nome = useId();
  if (modelos.estado === "carregando") return <p className="text-tinta-3">Carregando os modelos…</p>;
  if (modelos.estado === "erro") return <Falha texto="Não deu para listar os modelos." erro={modelos.erro} tentar={relerModelos} />;
  return (
    <div role="radiogroup" aria-label="Modelo" className="flex flex-col overflow-hidden rounded-[12px] border border-linha-forte">
      {modelos.dados.map((m) => {
        const marcado = m.id === valor;
        const motivo = !m.disponivel ? "Sem chave de API" : null;
        // O modelo em uso continua marcável mesmo sem chave, para não sumir da lista.
        const desabilitado = !m.disponivel && m.id !== salvo;
        return (
          <label
            key={m.id}
            className={`flex min-h-12 items-center gap-3 border-t border-linha px-3.5 py-2.5 first:border-t-0 has-[input:focus-visible]:outline-2 has-[input:focus-visible]:-outline-offset-2 has-[input:focus-visible]:outline-tinta ${
              m.disponivel ? "cursor-pointer transition-colors duration-150 hover:bg-fundo" : "cursor-not-allowed"
            } ${marcado ? "bg-fundo" : ""}`}
          >
            <input
              type="radio"
              name={nome}
              value={m.id}
              checked={marcado}
              disabled={desabilitado}
              onChange={() => aoMudar(m.id)}
              className="sr-only"
            />
            <span
              aria-hidden="true"
              className={`grid size-4 flex-none place-items-center rounded-full border ${marcado ? "border-tinta bg-tinta" : "border-tinta/25"}`}
            >
              {marcado && <span className="size-1.5 rounded-full bg-sobre-tinta" />}
            </span>
            <span className={`flex min-w-0 flex-1 flex-col ${desabilitado ? "text-tinta-4" : m.disponivel ? "" : "text-tinta-2"}`}>
              <span className="font-medium">{m.nome}</span>
              <span title={m.id} className="truncate font-mono text-xs text-tinta-3">{m.id}</span>
            </span>
            {motivo && <span className="flex-none text-right text-xs text-tinta-3">{motivo}</span>}
          </label>
        );
      })}
    </div>
  );
}

/** Prompt, regras e memória: monoespaçado, cresce com o texto e conta os caracteres contra o limite da rota. */
export function TextoLongo({
  id,
  valor,
  limite,
  problema,
  aoMudar,
  campoRef,
  baixo = false,
  placeholder,
}: {
  id: string;
  valor: string;
  limite: number;
  problema?: string | undefined;
  aoMudar: (v: string) => void;
  campoRef?: (el: HTMLTextAreaElement | null) => void;
  /** Começa com 6 linhas em vez de 16. */
  baixo?: boolean;
  placeholder?: string;
}) {
  const ref = useAutoAltura(valor);
  const n = valor.trim().length;
  const cor = n > limite ? "text-erro" : n > limite * 0.95 ? "text-esperando-texto" : "text-tinta-3";
  return (
    <>
      <textarea
        id={id}
        ref={(el) => {
          ref.current = el;
          campoRef?.(el);
        }}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={placeholder}
        spellCheck
        aria-invalid={problema ? true : undefined}
        aria-describedby={`${id}-conta ${problema ? `${id}-erro` : ""}`}
        className={`${estiloCampo} max-h-[60vh] ${baixo ? "min-h-32" : "min-h-64"} resize-none overflow-y-auto overscroll-contain font-mono text-base/relaxed sm:text-[13px]/relaxed`}
      />
      <div className="flex items-start justify-between gap-3">
        <Problema id={`${id}-erro`} texto={problema} />
        <span id={`${id}-conta`} className={`tabular ml-auto flex-none font-mono text-xs ${cor}`}>
          {conta(n)} de {conta(limite)} caracteres
        </span>
      </div>
    </>
  );
}

/** Confirmação no lugar do botão. Esc cancela antes de chegar ao "Esc descarta" da página. */
export function Confirmar({
  pergunta,
  confirmar,
  rotulo,
  cancelar,
}: {
  pergunta: string;
  confirmar: () => void;
  rotulo: string;
  cancelar: () => void;
}) {
  const botao = useRef<HTMLButtonElement>(null);
  useEffect(() => botao.current?.focus(), []);
  return (
    <div
      role="group"
      aria-label={pergunta}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        cancelar();
      }}
      className="sobe flex flex-wrap items-center gap-2"
    >
      <p className="mr-auto text-[13px] text-pretty text-tinta-2">{pergunta}</p>
      <button type="button" onClick={cancelar} className="pressiona rounded-full px-3.5 py-1.5 font-medium text-tinta-2 hover:bg-hover">
        Cancelar
      </button>
      <button ref={botao} type="button" onClick={confirmar} className="pressiona rounded-full bg-tinta px-3.5 py-1.5 font-medium text-sobre-tinta">
        {rotulo}
      </button>
    </div>
  );
}

/**
 * O setor num dropdown com os que já existem (Combobox do UI SDK da Vercel). Digitar um nome que não está
 * na lista cria um setor novo: o valor é o texto, confirmado com Enter ou ao sair do campo.
 */
export function Setor({
  id,
  valor,
  setores,
  aoMudar,
  campoRef,
  invalido,
  descrito,
}: {
  id: string;
  valor: string;
  setores: readonly string[];
  aoMudar: (v: string) => void;
  campoRef?: (el: HTMLInputElement | null) => void;
  invalido: boolean;
  descrito: string | undefined;
}) {
  return (
    <Combobox<string> value={valor || null} onValueChange={(v) => aoMudar(v ?? "")} allowCustomValue autoHighlight>
      <div className="relative">
        <ComboboxInput
          id={id}
          ref={campoRef}
          maxLength={40}
          placeholder="Escolha ou digite um setor"
          aria-invalid={invalido || undefined}
          aria-describedby={descrito}
          className={`${estiloCampo} pr-10`}
        />
        <ComboboxTrigger
          aria-label="Ver os setores"
          className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-hover hover:text-tinta"
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 4.5 6 7.5l3-3" />
          </svg>
        </ComboboxTrigger>
      </div>
      <ComboboxContent
        sideOffset={6}
        className="setor-popup z-50 max-h-[min(280px,var(--available-height))] w-(--anchor-width) overflow-y-auto overscroll-contain rounded-[12px] border border-linha-forte bg-superficie p-1 shadow-[0_8px_24px_rgb(15_13_10/0.10)]"
      >
        <ComboboxList className="flex flex-col">
          {setores.map((s) => (
            <ComboboxItem
              key={s}
              value={s}
              className="flex min-h-9 cursor-pointer outline-none items-center rounded-[8px] px-2.5 text-sm text-tinta-2 data-highlighted:bg-hover data-highlighted:text-tinta data-selected:font-medium data-selected:text-tinta"
            >
              {s}
            </ComboboxItem>
          ))}
        </ComboboxList>
        <ComboboxEmpty className="px-2.5 py-2 text-[13px] empty:hidden text-tinta-3">Setor novo. Enter confirma o nome.</ComboboxEmpty>
      </ComboboxContent>
    </Combobox>
  );
}
