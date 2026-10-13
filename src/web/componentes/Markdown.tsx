import { defaultRehypePlugins, Streamdown, type Components } from "streamdown";

/**
 * Sem o rehype-raw padrão do Streamdown: HTML que o modelo escrever aparece como texto e
 * nunca vira elemento. O harden troca links javascript: e afins por texto.
 */
const REHYPE = [defaultRehypePlugins.harden!];

/** Link ainda incompleto no meio do stream; o Streamdown marca o href assim. */
const INCOMPLETO = "streamdown:incomplete-link";

const COMPONENTES: Components = {
  strong: ({ children }) => <strong className="font-semibold text-tinta">{children}</strong>,
  ul: ({ children }) => <ul className="list-disc pl-5 marker:text-tinta-4 [&>li+li]:mt-1">{children}</ul>,
  ol: ({ children }) => <ol className="tabular list-decimal pl-5 marker:text-tinta-3 [&>li+li]:mt-1">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  a: ({ href, children }) =>
    !href || href === INCOMPLETO ? (
      <span>{children}</span>
    ) : (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-linha-forte underline-offset-2 transition-colors duration-150 hover:decoration-tinta"
      >
        {children}
      </a>
    ),
  code: ({ children, className }) => (
    <code className={`rounded-[6px] bg-ativo px-1 py-px font-mono text-[0.9em] ${className ?? ""}`}>{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-item bg-ativo px-3.5 py-3 font-mono text-[13px]/relaxed [&>code]:bg-transparent [&>code]:p-0 [&>code]:text-[1em]">
      {children}
    </pre>
  ),
  // Título no meio de uma resposta não entra no outline da página: vira parágrafo em negrito.
  h1: ({ children }) => <p className="font-semibold text-tinta">{children}</p>,
  h2: ({ children }) => <p className="font-semibold text-tinta">{children}</p>,
  h3: ({ children }) => <p className="font-semibold text-tinta">{children}</p>,
  h4: ({ children }) => <p className="font-semibold text-tinta">{children}</p>,
  blockquote: ({ children }) => <blockquote className="border-l-2 border-linha-forte pl-3 text-tinta-2">{children}</blockquote>,
  hr: () => <hr className="border-linha-forte" />,
  table: ({ children }) => (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-linha-forte py-1.5 pr-4 font-semibold">{children}</th>,
  td: ({ children }) => <td className="border-b border-linha py-1.5 pr-4 align-top">{children}</td>,
  img: () => null,
};

/** O cursor do StreamText do Beautiful UI (MIT, Shane Levine): 2px, 1.05em, firme enquanto o texto chega. No fim do último bloco; numa lista, no fim do último item. */
const CURSOR = [
  "[&>:last-child:not(ol,ul),&>:last-child>li:last-child]:after:ml-[1.5px]",
  "[&>:last-child:not(ol,ul),&>:last-child>li:last-child]:after:inline-block",
  "[&>:last-child:not(ol,ul),&>:last-child>li:last-child]:after:h-[1.05em]",
  "[&>:last-child:not(ol,ul),&>:last-child>li:last-child]:after:w-0.5",
  "[&>:last-child:not(ol,ul),&>:last-child>li:last-child]:after:align-text-bottom",
  "[&>:last-child:not(ol,ul),&>:last-child>li:last-child]:after:rounded-[1px]",
  "[&>:last-child:not(ol,ul),&>:last-child>li:last-child]:after:bg-tinta",
  "[&>:last-child:not(ol,ul),&>:last-child>li:last-child]:after:content-['']",
].join(" ");

/** Cada palavra nova sai do desfoque (sd-rastro, em estilo.css), como o rastro do StreamText. */
const RASTRO = { animation: "rastro", sep: "word", duration: 260, easing: "cubic-bezier(0.23, 1, 0.32, 1)" } as const;

/** Texto de um bot em Markdown. Aguenta o texto pela metade do streaming: negrito e código abertos já saem formatados. */
export function Markdown({ texto, digitando = false, className = "" }: { texto: string; digitando?: boolean; className?: string }) {
  return (
    <Streamdown
      className={`flex flex-col gap-3 space-y-0 ${digitando ? CURSOR : ""} ${className}`}
      components={COMPONENTES}
      rehypePlugins={REHYPE}
      controls={false}
      animated={RASTRO}
      isAnimating={digitando}
    >
      {texto}
    </Streamdown>
  );
}
