import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { apiReferencias } from "../../api";
import type { ControleDaEscolha } from "./escolha";

/** Rola de lado quando não cabe; o degradê na borda direita mostra que tem mais. */
const CLASSE_DA_FILA =
  "-mb-0.5 flex gap-2.5 overflow-x-auto pt-1.5 pr-2 pb-1.5 [scrollbar-width:none] [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]";

/**
 * As imagens que vão com a próxima mensagem, acima do campo: as coladas e as referências marcadas, com o selo da
 * Biblioteca. Cada uma sai no ×. Some quando não há nenhuma.
 */
export function Fila({ controle }: { controle: ControleDaEscolha }) {
  const { escolha, alternar, tirar } = controle;
  const reduzido = useReducedMotion();
  if (!escolha.coladas.length && !escolha.marcadas.length) return null;
  const entrada = reduzido ? { opacity: 0 } : { opacity: 0, scale: 0.9 };
  const saida = reduzido ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, scale: 0.9, transition: { duration: 0.15 } };
  const item = (chave: string, conteudo: React.ReactNode) => (
    <motion.li
      key={chave}
      layout={!reduzido}
      initial={entrada}
      animate={{ opacity: 1, scale: 1 }}
      exit={saida}
      transition={{ type: "spring", bounce: 0, duration: 0.25 }}
      className="relative size-12 flex-none"
    >
      {conteudo}
    </motion.li>
  );

  return (
    <ul aria-label="Imagens deste pedido" className={CLASSE_DA_FILA}>
      <AnimatePresence initial={false} mode="popLayout">
        {escolha.coladas.map((c) =>
          item(
            `colada-${c.id}`,
            <Miniatura
              src={c.previa}
              alt={`Imagem deste pedido: ${c.arquivo.name || "imagem colada"}`}
              estado={c.estado === "pronta" ? "pronto" : c.estado === "subindo" ? "subindo" : "erro"}
              detalhe={c.estado === "falhou" ? c.erro : null}
              tirar={() => tirar(c.id)}
              rotuloTirar="Tirar a imagem do pedido"
            />,
          ),
        )}
        {escolha.marcadas.map((r) =>
          item(
            `marcada-${r.id}`,
            <Miniatura src={apiReferencias.imagem(r)} alt={`Referência da Biblioteca: ${r.leitura}`} biblioteca tirar={() => alternar(r)} rotuloTirar="Tirar a referência do pedido" />,
          ),
        )}
      </AnimatePresence>
    </ul>
  );
}

function Miniatura({
  src,
  alt,
  biblioteca = false,
  estado = "pronto",
  detalhe = null,
  tirar,
  rotuloTirar,
}: {
  src: string;
  alt: string;
  biblioteca?: boolean;
  estado?: "pronto" | "subindo" | "erro";
  detalhe?: string | null;
  tirar: () => void;
  rotuloTirar: string;
}) {
  return (
    <>
      <span
        title={detalhe ?? undefined}
        className={`relative block size-12 rounded-miniatura after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] ${
          estado === "erro" ? "after:shadow-[inset_0_0_0_1.5px_var(--color-erro)]" : "after:shadow-[inset_0_0_0_0.5px_var(--color-separador)]"
        }`}
      >
        <img src={src} alt={alt} className={`block size-12 overflow-hidden rounded-miniatura bg-painel object-cover text-transparent ${estado === "erro" ? "opacity-50" : ""}`} />
        {biblioteca && (
          <span
            aria-hidden="true"
            className="absolute bottom-[3px] left-[3px] grid size-[18px] place-items-center rounded-full material-fino text-tinta shadow-[0_0_0_0.5px_var(--color-separador),0_1px_2px_var(--color-sombra-perto)]"
          >
            <svg viewBox="0 0 12 12" width="10" height="10">
              <path d="M3 1.5h6v9L6 8.5 3 10.5z" fill="currentColor" />
            </svg>
          </span>
        )}
        {estado === "subindo" && (
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center rounded-miniatura bg-velado">
            <svg viewBox="0 0 24 24" width="22" height="22" className="animate-spin motion-reduce:animate-none">
              <circle cx="12" cy="12" r="9" fill="none" stroke="rgb(255 255 255 / .45)" strokeWidth="2.5" />
              <circle cx="12" cy="12" r="9" fill="none" stroke="var(--color-superficie)" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="34 57" transform="rotate(-90 12 12)" />
            </svg>
          </span>
        )}
        {estado === "erro" && (
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
            <svg viewBox="0 0 16 16" className="box-content size-4 rounded-full bg-erro p-0.5 text-superficie shadow-[0_0_0_1.5px_var(--color-superficie)]">
              <path d="M8 4.5v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="8" cy="11.75" r="1.1" fill="currentColor" />
            </svg>
          </span>
        )}
      </span>
      <button
        type="button"
        aria-label={rotuloTirar}
        onClick={tirar}
        className="absolute -top-1.5 -right-1.5 z-[1] grid size-5 cursor-pointer place-items-center rounded-full bg-tinta-2 text-sobre-tinta shadow-[0_0_0_1.5px_var(--color-superficie),0_1px_2px_var(--color-sombra-perto)] after:absolute after:-inset-1.5"
      >
        <svg aria-hidden="true" viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 3l6 6M9 3l-6 6" />
        </svg>
      </button>
    </>
  );
}
