import { Dialog } from "@base-ui/react/dialog";
import { AnimatePresence, motion, useReducedMotion, type PanInfo } from "motion/react";
import { useId, useRef, useState } from "react";
import type { Ancora } from "../../../domain/art/pipeline";
import { apiImagensDoPedido } from "../../api";
import { DESKTOP, useMedia } from "../../media";
import { navegar } from "../../rota";
import { naBiblioteca, useBiblioteca } from "./biblioteca";
import { GuardarNaBiblioteca } from "./Guardar";

/** Uma variação como a linha de referências usadas lê: `ancora` null é variação livre; sem a chave, arte de antes delas. */
interface ComAncora {
  variante: number;
  ancora?: Ancora | null;
}

/** De onde a imagem aberta cresce e para onde volta ao fechar. */
interface Aberta {
  variante: number;
  ancora: Ancora;
  origem: { x: number; y: number; escala: number };
  /** A célula que abriu: o foco volta para ela. */
  celula: HTMLButtonElement | null;
}

/** A largura da imagem aberta: 420 no desktop, a tela menos 16 px de cada lado no celular. */
const largura = () => Math.min(420, innerWidth - 32);

/**
 * A linha acima das 3 variações que diz qual imagem ancorou cada uma, na mesma grade de 3 colunas. Tocar abre a imagem
 * grande. Artes de antes das referências no chat não têm a informação, e a linha não aparece.
 */
export function ReferenciasUsadas({ artes }: { artes: readonly ComAncora[] }) {
  const desktop = useMedia(DESKTOP);
  const [aberta, setAberta] = useState<Aberta | null>(null);
  const [aberto, setAberto] = useState(false);
  const origens = useRef(new Map<number, HTMLButtonElement>());
  const titulo = useId();
  if (!artes.some((a) => "ancora" in a)) return null;

  function abrir(variante: number, ancora: Ancora) {
    const celula = origens.current.get(variante) ?? null;
    const r = celula?.querySelector("img")?.getBoundingClientRect();
    const origem = r ? { x: r.left + r.width / 2 - innerWidth / 2, y: r.top + r.height / 2 - innerHeight / 2, escala: r.width / largura() } : { x: 0, y: 0, escala: 0.9 };
    setAberta({ variante, ancora, origem, celula });
    setAberto(true);
  }

  return (
    <section aria-labelledby={titulo} className="flex max-w-2xl flex-col gap-1">
      <h3 id={titulo} className="text-legenda font-medium text-tinta-3">
        Referências usadas
      </h3>
      <ul className="grid grid-cols-3 gap-2.5 sm:gap-3">
        {artes.map((a) => (
          <li key={a.variante} className="@container min-w-0">
            {a.ancora ? (
              <button
                ref={(b) => void (b ? origens.current.set(a.variante, b) : origens.current.delete(a.variante))}
                type="button"
                onClick={() => abrir(a.variante, a.ancora!)}
                aria-label={`Variação ${a.variante}: ${a.ancora.origem === "biblioteca" ? a.ancora.leitura : "imagem deste pedido"}. Abrir a referência`}
                className="pressiona -m-1 flex w-[calc(100%+8px)] min-w-0 cursor-pointer items-center gap-2 rounded-[12px] p-1 text-left hover:bg-preenchimento @max-[7rem]:flex-col @max-[7rem]:items-start @max-[7rem]:gap-1.5"
              >
                <Miniatura src={apiImagensDoPedido.url(a.ancora.arquivo)} tamanho={desktop ? 36 : 28} />
                <Rotulo variante={a.variante} leitura={desktop ? (a.ancora.origem === "biblioteca" ? a.ancora.leitura : "Imagem deste pedido") : null} />
              </button>
            ) : (
              <div className="-m-1 flex min-w-0 items-center gap-2 p-1 @max-[7rem]:flex-col @max-[7rem]:items-start @max-[7rem]:gap-1.5">
                {/* Entre 7 e 8 rem a célula não cabe o quadrado e o "Sem referência" lado a lado: o quadrado sai, e a falta da imagem já diz. */}
                <span aria-hidden="true" className={`flex-none rounded-miniatura bg-preenchimento @min-[7rem]:@max-[8rem]:hidden ${desktop ? "size-9" : "size-7"}`} />
                <span className="flex min-w-0 flex-col items-start">
                  <span className="text-legenda font-semibold whitespace-nowrap text-tinta">Variação {a.variante}</span>
                  <span className="mt-0.5 rounded-full bg-preenchimento px-1.5 text-legenda-2/[18px] whitespace-nowrap text-tinta-2">Sem referência</span>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>
      <Visor aberta={aberta} aberto={aberto} fechar={() => setAberto(false)} desktop={desktop} />
    </section>
  );
}

function Miniatura({ src, tamanho }: { src: string; tamanho: number }) {
  return (
    <span className="relative flex-none rounded-miniatura after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_0.5px_var(--color-separador)]">
      <img src={src} alt="" loading="lazy" width={tamanho} height={tamanho} style={{ width: tamanho, height: tamanho }} className="block rounded-miniatura bg-painel object-cover" />
    </span>
  );
}

function Rotulo({ variante, leitura }: { variante: number; leitura: string | null }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-legenda font-semibold whitespace-nowrap text-tinta">Variação {variante}</span>
      {leitura && <span className="truncate text-legenda text-tinta-3">{leitura}</span>}
    </span>
  );
}

const DIA = 86_400_000;

function quandoGuardada(iso: string): string {
  const inicio = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const dias = Math.round((inicio(new Date()) - inicio(new Date(iso))) / DIA);
  if (dias <= 0) return "guardada hoje";
  if (dias === 1) return "guardada ontem";
  if (dias < 7) return `guardada há ${dias} dias`;
  const data = new Date(iso);
  const ano = data.getFullYear() === new Date().getFullYear() ? undefined : "numeric";
  return `guardada em ${data.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: ano })}`;
}

/**
 * A referência aberta grande, num diálogo com o fundo escurecido. Cresce da miniatura da célula com mola sem quique e
 * volta para ela ao fechar. No celular, arrastar para baixo fecha, levando a velocidade do dedo.
 */
function Visor({ aberta, aberto, fechar, desktop }: { aberta: Aberta | null; aberto: boolean; fechar: () => void; desktop: boolean }) {
  const reduzido = useReducedMotion();
  const carga = useBiblioteca();
  if (!aberta) return null;
  const { ancora, variante, origem, celula } = aberta;
  const naLista = ancora.origem === "biblioteca" ? naBiblioteca(carga, ancora.arquivo) : undefined;
  const fora = reduzido ? { opacity: 0 } : { opacity: 0, x: origem.x, y: origem.y, scale: origem.escala };
  const soltar = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) fechar();
  };
  const legenda =
    ancora.origem === "pedido"
      ? `Variação ${variante} · imagem deste pedido`
      : `Variação ${variante} · referência da Biblioteca${naLista ? `, ${quandoGuardada(naLista.criadaEm)}` : ""}`;

  return (
    <Dialog.Root open={aberto} onOpenChange={(a) => !a && fechar()}>
      <AnimatePresence>
        {aberto && (
          <Dialog.Portal keepMounted>
            <Dialog.Backdrop
              render={<motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />}
              className="fixed inset-0 z-[80] bg-veu"
            />
            <div className="pointer-events-none fixed inset-0 z-[80] grid place-items-center p-4">
              <Dialog.Popup
                finalFocus={() => celula}
                render={
                  <motion.div
                    initial={fora}
                    animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                    exit={fora}
                    transition={{ type: "spring", bounce: 0, duration: 0.35, opacity: { duration: 0.2 } }}
                    drag={!desktop && !reduzido ? "y" : false}
                    dragConstraints={{ top: 0, bottom: 0 }}
                    dragElastic={{ top: 0.05, bottom: 0.9 }}
                    dragSnapToOrigin
                    onDragEnd={soltar}
                  />
                }
                className="material-grosso pointer-events-auto relative flex max-h-full w-[min(420px,calc(100vw-32px))] flex-col overflow-hidden rounded-[20px] text-tinta shadow-popover outline-none"
              >
                <img src={apiImagensDoPedido.url(ancora.arquivo)} alt="" draggable={false} className="block max-h-[60dvh] w-full flex-none bg-painel object-cover" />
                <Dialog.Close
                  aria-label="Fechar"
                  className="pressiona absolute top-3 right-3 grid size-[26px] cursor-pointer place-items-center rounded-full material-fino text-tinta shadow-[0_0_0_0.5px_var(--color-separador),0_1px_3px_var(--color-sombra-perto)] after:absolute after:-inset-2"
                >
                  <svg aria-hidden="true" viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M3 3l6 6M9 3l-6 6" />
                  </svg>
                </Dialog.Close>
                <div className="flex min-h-0 flex-col items-start gap-1.5 overflow-y-auto px-[18px] pt-3.5 pb-[18px]">
                  <Dialog.Title className="text-legenda font-normal text-tinta-3">{legenda}</Dialog.Title>
                  {ancora.origem === "biblioteca" && <Dialog.Description className="text-titulo text-pretty">{ancora.leitura}</Dialog.Description>}
                  <div className="mt-2">
                    {ancora.origem === "pedido" ? (
                      <GuardarNaBiblioteca chave={ancora.arquivo} />
                    ) : (
                      naLista && (
                        <button
                          type="button"
                          onClick={() => (fechar(), navegar("/biblioteca"))}
                          className="pressiona h-8 cursor-pointer rounded-full bg-preenchimento px-4 text-nota font-semibold hover:bg-preenchimento-forte"
                        >
                          Ver na Biblioteca
                        </button>
                      )
                    )}
                  </div>
                </div>
              </Dialog.Popup>
            </div>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}
