/** Uma leitura que falhou: o que não carregou, o detalhe do servidor e, quando dá, o botão de tentar de novo. */
export function Falha({ texto, erro, tentar, className = "" }: { texto: string; erro?: Error | string | null; tentar?: () => void; className?: string }) {
  const detalhe = typeof erro === "string" ? erro : erro?.message;
  return (
    <div role="alert" className={`flex flex-col items-start gap-2 ${className}`}>
      <p className="text-pretty text-erro [overflow-wrap:anywhere]">
        {texto}
        {detalhe && <span className="mt-0.5 block text-[13px] text-tinta-2">{detalhe}</span>}
      </p>
      {tentar && (
        <button
          type="button"
          onClick={tentar}
          className="pressiona cursor-pointer rounded-full bg-linha px-3.5 py-1.5 text-[13px] font-medium hover:bg-linha-forte"
        >
          Tentar de novo
        </button>
      )}
    </div>
  );
}
