import { Drawer } from "@base-ui/react/drawer";
import { Popover } from "@base-ui/react/popover";
import { useId, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from "react";
import { MAXIMO_MARCADAS } from "../../../agent/limitesDoPedido";
import { apiReferencias, type ReferenciaDaApi } from "../../api";
import { DESKTOP, useMedia } from "../../media";
import { navegar } from "../../rota";
import { recarregarBiblioteca, useBiblioteca } from "./biblioteca";

/** O ícone de duas fotos empilhadas do botão Referências e do estado vazio. */
export function IconeReferencias({ tamanho = 18 }: { tamanho?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width={tamanho} height={tamanho} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.25" y="5.25" width="12" height="12" rx="3" />
      <path d="M6 2.75h8.25a3.5 3.5 0 0 1 3.5 3.5V14" />
      <path d="M2.6 14.6l3.4-3.3 2.7 2.6 1.5-1.4 3.9 3.8" />
    </svg>
  );
}

const CLASSE_DO_BOTAO =
  "pressiona -ml-2 flex h-[34px] cursor-pointer items-center gap-[7px] rounded-full pr-2.5 pl-[9px] text-nota font-medium tracking-[-0.003em] whitespace-nowrap text-tinta-2 hover:bg-preenchimento hover:text-tinta data-marcado:text-tinta data-popup-open:bg-preenchimento-forte data-popup-open:text-tinta";

interface Partes {
  Titulo: ComponentType<{ className?: string; children: ReactNode }>;
  Descricao: ComponentType<{ className?: string; children: ReactNode }>;
  Fechar: ComponentType<{ className?: string; children: ReactNode }>;
}

/**
 * O botão Referências do composer e o seletor da Biblioteca que ele abre: popover acima do botão no desktop, folha de
 * baixo no celular, que fecha arrastando para baixo. Marcar vale só para o próximo pedido; até 3.
 */
export function Seletor({ marcadas, alternar }: { marcadas: readonly ReferenciaDaApi[]; alternar: (r: ReferenciaDaApi) => void }) {
  const [aberto, setAberto] = useState(false);
  const desktop = useMedia(DESKTOP);
  const n = marcadas.length;
  const abrir = (a: boolean) => {
    if (a) void recarregarBiblioteca();
    setAberto(a);
  };
  const conteudoDoBotao = (
    <>
      <IconeReferencias />
      <span className="max-sm:sr-only">Referências</span>
      {n > 0 && (
        <span className="h-[18px] min-w-[18px] rounded-full bg-tinta px-[5px] text-center text-legenda-2/[18px] font-semibold text-sobre-tinta tabular-nums">{n}</span>
      )}
    </>
  );
  const rotulo = n ? `Referências, ${n} ${n === 1 ? "marcada" : "marcadas"}` : "Referências";
  const corpo = (partes: Partes, forma: "popover" | "folha") => <Conteudo forma={forma} partes={partes} marcadas={marcadas} alternar={alternar} />;

  return (
    <>
      {/* Existe antes de abrir, para o leitor de tela anunciar cada marcação. */}
      <span role="status" className="sr-only">
        {aberto ? `${n} de ${MAXIMO_MARCADAS} marcadas` : ""}
      </span>
      {desktop ? (
        <Popover.Root open={aberto} onOpenChange={abrir}>
          <Popover.Trigger aria-label={rotulo} data-marcado={n > 0 || undefined} className={CLASSE_DO_BOTAO}>
            {conteudoDoBotao}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner side="top" align="start" sideOffset={10} alignOffset={-8} collisionPadding={16} className="z-[60]">
              <Popover.Popup className="seletor-popup material-grosso relative flex h-[min(520px,var(--available-height))] w-[min(420px,calc(100vw-32px))] flex-col rounded-popover text-nota text-tinta shadow-popover outline-none">
                <Popover.Arrow className="h-2 w-4 overflow-hidden data-[side=top]:-bottom-[7px] before:absolute before:-top-1.5 before:left-0.5 before:size-3 before:rotate-45 before:rounded-[2px] before:bg-material-grosso before:shadow-[0_0_0_0.5px_var(--color-separador)]" />
                {corpo({ Titulo: Popover.Title, Descricao: Popover.Description, Fechar: Popover.Close }, "popover")}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        <Drawer.Root open={aberto} onOpenChange={abrir}>
          <Drawer.Trigger aria-label={rotulo} data-marcado={n > 0 || undefined} className={CLASSE_DO_BOTAO}>
            {conteudoDoBotao}
          </Drawer.Trigger>
          <Drawer.Portal>
            <Drawer.Backdrop className="folha-fundo fixed inset-0 z-[60] bg-veu" />
            <Drawer.Viewport className="fixed inset-0 z-[60] flex items-end">
              <Drawer.Popup className="folha material-grosso relative flex h-[calc(100dvh-48px)] w-full flex-col rounded-t-folha text-nota text-tinta shadow-[inset_0_0.5px_0_var(--color-borda-material),0_0_0_0.5px_var(--color-separador),0_-12px_40px_var(--color-sombra-longe)] outline-none">
                <span aria-hidden="true" className="mx-auto mt-1.5 h-[5px] w-9 flex-none rounded-full bg-preenchimento-forte" />
                {corpo({ Titulo: Drawer.Title, Descricao: Drawer.Description, Fechar: Drawer.Close }, "folha")}
              </Drawer.Popup>
            </Drawer.Viewport>
          </Drawer.Portal>
        </Drawer.Root>
      )}
    </>
  );
}

function Conteudo({
  forma,
  partes: { Titulo, Descricao, Fechar },
  marcadas,
  alternar,
}: {
  forma: "popover" | "folha";
  partes: Partes;
  marcadas: readonly ReferenciaDaApi[];
  alternar: (r: ReferenciaDaApi) => void;
}) {
  const carga = useBiblioteca();
  const notaId = useId();
  const folha = forma === "folha";
  const cheio = marcadas.length >= MAXIMO_MARCADAS;
  const lista = carga.estado === "pronto" ? carga.dados : [];
  const nota =
    carga.estado === "carregando"
      ? "Carregando as referências…"
      : carga.estado === "erro"
        ? "As imagens coladas continuam no pedido."
        : !lista.length
          ? "Cole uma imagem no campo para usar só neste pedido."
          : cheio
            ? `Até ${MAXIMO_MARCADAS} por pedido. Desmarque uma para trocar.`
            : folha
              ? "Toque para marcar ou desmarcar."
              : "Clique para marcar ou desmarcar.";
  const avisoDeCheio = cheio && lista.length > 0;

  const pronto = (
    <Fechar
      className={`pressiona flex-none cursor-pointer rounded-full bg-tinta px-4 font-semibold text-sobre-tinta ${folha ? "h-[34px] text-manchete" : "h-8 text-nota"}`}
    >
      Pronto
    </Fechar>
  );

  return (
    <>
      {folha && <div className="flex h-11 flex-none items-center justify-end px-3">{pronto}</div>}
      <div className={`flex flex-none items-start gap-3 ${folha ? "px-5 pt-0.5 pb-3.5" : "pt-4 pr-4 pb-3 pl-[18px]"}`}>
        <div className="min-w-0 flex-1">
          <Titulo className={folha ? "text-titulo-grande font-bold" : "text-titulo font-semibold"}>Referências da Biblioteca</Titulo>
          <Descricao className={folha ? "mt-1.5 text-titulo text-tinta-3" : "mt-0.5 text-legenda text-tinta-3"}>
            Valem só para o próximo pedido.
          </Descricao>
        </div>
        <span
          aria-hidden="true"
          data-cheio={cheio || undefined}
          className={`flex-none rounded-full bg-preenchimento font-semibold text-tinta-2 tabular-nums data-cheio:bg-tinta data-cheio:text-sobre-tinta ${
            folha ? "absolute top-[22px] left-5 h-7 px-3 text-nota/7" : "h-6 px-2.5 text-legenda/6"
          }`}
        >
          {marcadas.length} de {MAXIMO_MARCADAS}
        </span>
      </div>

      <div className={`relative min-h-0 flex-1 overflow-y-auto overscroll-contain ${folha ? "px-5 pt-0.5 pb-3" : "pr-4 pb-3 pl-[18px]"}`}>
        {carga.estado === "carregando" ? (
          <Esqueleto />
        ) : carga.estado === "erro" ? (
          <div role="alert" className="flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="var(--color-erro)" strokeWidth="1.5" strokeLinejoin="round" className="mb-2">
              <path d="M12 3.5 21.5 20h-19z" />
              <path d="M12 10v4.5" strokeLinecap="round" />
              <circle cx="12" cy="17.2" r=".9" fill="var(--color-erro)" stroke="none" />
            </svg>
            <p className="text-titulo font-semibold">Não deu para carregar as referências.</p>
            <p className="text-nota text-pretty text-tinta-2">{carga.erro.message}</p>
            <button
              type="button"
              onClick={() => void recarregarBiblioteca()}
              className="pressiona mt-3 h-9 cursor-pointer rounded-full bg-preenchimento px-4 text-nota font-semibold hover:bg-preenchimento-forte"
            >
              Tentar de novo
            </button>
          </div>
        ) : !lista.length ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 px-8 text-center">
            <span className="mb-2 text-tinta-2">
              <IconeReferencias tamanho={36} />
            </span>
            <p className="text-titulo font-semibold">A Biblioteca ainda não tem referências</p>
            <p className="text-nota text-pretty text-tinta-2">
              Lá você guarda as imagens que inspiram as artes. Depois elas aparecem aqui para marcar em qualquer pedido.
            </p>
            <button
              type="button"
              onClick={() => navegar("/biblioteca")}
              className="pressiona mt-3 flex h-9 cursor-pointer items-center gap-1 rounded-full bg-preenchimento pr-3 pl-4 text-nota font-semibold hover:bg-preenchimento-forte"
            >
              Abrir a Biblioteca
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 3.5 4.5 4.5L6 12.5" />
              </svg>
            </button>
          </div>
        ) : (
          <Grade lista={lista} marcadas={marcadas} alternar={alternar} cheio={cheio} notaId={notaId} />
        )}
      </div>

      <div
        className={`flex flex-none items-center gap-3 shadow-[inset_0_0.5px_0_var(--color-separador)] ${
          folha ? "justify-center px-5 pt-2.5 pb-[max(30px,env(safe-area-inset-bottom))]" : "pt-2.5 pr-3 pb-3 pl-[18px]"
        }`}
      >
        <p
          id={notaId}
          className={`min-w-0 text-legenda ${folha ? "text-center" : "flex-1"} ${avisoDeCheio ? "font-medium text-tinta" : "text-tinta-3"}`}
        >
          {nota}
        </p>
        {!folha && pronto}
      </div>
    </>
  );
}

const PASSOS: Record<string, (i: number, total: number) => number> = {
  ArrowRight: (i) => i + 1,
  ArrowLeft: (i) => i - 1,
  ArrowDown: (i) => i + 3,
  ArrowUp: (i) => i - 3,
  Home: () => 0,
  End: (_, total) => total - 1,
};

/** As referências em 3 colunas, mais novas primeiro. Tab entra na grade uma vez e as setas andam por ela. */
function Grade({
  lista,
  marcadas,
  alternar,
  cheio,
  notaId,
}: {
  lista: readonly ReferenciaDaApi[];
  marcadas: readonly ReferenciaDaApi[];
  alternar: (r: ReferenciaDaApi) => void;
  cheio: boolean;
  notaId: string;
}) {
  const [ativo, setAtivo] = useState(0);
  const grade = useRef<HTMLDivElement>(null);
  const atual = Math.min(ativo, lista.length - 1);

  function andar(e: KeyboardEvent) {
    const passo = PASSOS[e.key];
    if (!passo) return;
    e.preventDefault();
    const i = Math.max(0, Math.min(lista.length - 1, passo(atual, lista.length)));
    setAtivo(i);
    grade.current?.querySelectorAll<HTMLButtonElement>("button")[i]?.focus();
  }

  return (
    <div ref={grade} role="group" aria-label="Referências da Biblioteca" onKeyDown={andar} className="grid grid-cols-3 gap-x-3 gap-y-3.5">
      {lista.map((r, i) => {
        const marcada = marcadas.some((m) => m.id === r.id);
        const bloqueada = cheio && !marcada;
        const estado = marcada ? "marcada" : bloqueada ? "bloqueada" : "livre";
        return (
          <button
            key={r.id}
            type="button"
            aria-pressed={marcada}
            aria-disabled={bloqueada || undefined}
            aria-describedby={bloqueada ? notaId : undefined}
            tabIndex={i === atual ? 0 : -1}
            onFocus={() => setAtivo(i)}
            onClick={() => !bloqueada && alternar(r)}
            data-estado={estado}
            className="group/ref flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-item text-left transition-transform duration-[120ms] ease-saida active:scale-[0.97] data-[estado=bloqueada]:cursor-not-allowed data-[estado=bloqueada]:active:scale-100"
          >
            <span className="relative block aspect-square overflow-hidden rounded-item bg-painel after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_0.5px_var(--color-separador)] group-data-[estado=bloqueada]/ref:opacity-40">
              <img src={apiReferencias.imagem(r)} alt="" loading="lazy" className="block size-full object-cover group-data-[estado=marcada]/ref:opacity-[.86]" />
              <span
                aria-hidden="true"
                className="absolute top-1.5 right-1.5 grid size-[22px] place-items-center rounded-full material-fino bg-preenchimento text-transparent shadow-[inset_0_0_0_1.5px_var(--color-superficie),0_1px_3px_var(--color-sombra-longe)] group-data-[estado=bloqueada]/ref:hidden group-data-[estado=marcada]/ref:bg-tinta group-data-[estado=marcada]/ref:text-sobre-tinta"
              >
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3.5 8.5l3 3 6-7" />
                </svg>
              </span>
            </span>
            <span className="line-clamp-2 text-legenda text-pretty text-tinta-3 group-data-[estado=bloqueada]/ref:opacity-40 group-data-[estado=marcada]/ref:font-medium group-data-[estado=marcada]/ref:text-tinta">
              {r.leitura}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** O tamanho final da grade enquanto a lista chega: o popover não pula quando ela aparece. */
function Esqueleto() {
  return (
    <div aria-hidden="true" className="grid grid-cols-3 gap-x-3 gap-y-3.5">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <span className="aspect-square rounded-item bg-preenchimento" />
          <span className="h-2.5 rounded-full bg-preenchimento" />
          <span className="h-2.5 w-3/5 rounded-full bg-preenchimento" />
        </div>
      ))}
    </div>
  );
}
