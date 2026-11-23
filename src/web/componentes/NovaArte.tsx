import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Formato } from "../../v2/camadas";
import { TIPOS, TIPOS_DE_ARTE, type TipoDeArte } from "../../v2/campos";
import { apiArtes, apiImagensDoPedido } from "../api";
import { navegar } from "../rota";
import { Falha } from "./Falha";
import { Segmentado } from "./Segmentado";

const ACEITOS = ["image/png", "image/jpeg", "image/webp"];
const MAXIMO = 10 * 1024 * 1024;

const TIPOS_DA_TELA = TIPOS.map((valor) => ({ valor, rotulo: TIPOS_DE_ARTE[valor].rotulo }));
const FORMATOS_DA_TELA = [
  { valor: "feed", rotulo: "Feed" },
  { valor: "story", rotulo: "Story" },
] as const;

const campo =
  "w-full min-w-0 rounded-[14px] border border-borda-campo bg-superficie px-3.5 py-2.5 text-base placeholder:text-tinta-4 sm:text-sm";

type Foto = { chave: string; url: string };

/**
 * Convite ou aniversário pela tela. O modelo de imagem pinta só a cena; cada campo vira uma camada de texto no editor,
 * com as palavras que a pessoa escreveu aqui. Campo vazio fica fora da arte.
 */
export function NovaArte({ fechar }: { fechar: () => void }) {
  const [tipo, setTipo] = useState<TipoDeArte>("convite");
  const [formato, setFormato] = useState<Formato>("feed");
  const [valores, setValores] = useState<Record<string, string>>({});
  const [foto, setFoto] = useState<Foto | null>(null);
  const [subindo, setSubindo] = useState(false);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const primeiro = useRef<HTMLInputElement>(null);
  const seletor = useRef<HTMLInputElement>(null);
  useEffect(() => primeiro.current?.focus({ preventScroll: true }), []);

  const { campos } = TIPOS_DE_ARTE[tipo];
  const algum = campos.some((c) => valores[c.nome]?.trim()) || (tipo === "aniversario" && !!foto);

  async function escolherFoto(arquivo: File | undefined) {
    if (!arquivo) return;
    if (!ACEITOS.includes(arquivo.type)) return setErro("A foto precisa ser PNG, JPEG ou WebP.");
    if (arquivo.size > MAXIMO) return setErro("A foto passa de 10 MB.");
    setErro(null);
    setSubindo(true);
    try {
      const { chave } = await apiImagensDoPedido.subir(arquivo);
      setFoto((antes) => (antes && URL.revokeObjectURL(antes.url), { chave, url: URL.createObjectURL(arquivo) }));
    } catch (e) {
      setErro(`Não deu para enviar a foto. ${(e as Error).message}`);
    } finally {
      setSubindo(false);
    }
  }

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!algum || criando) return;
    setErro(null);
    setCriando(true);
    try {
      const arte = await apiArtes.criar({
        tipo,
        formato,
        campos: { ...Object.fromEntries(campos.map((c) => [c.nome, valores[c.nome] ?? ""])), ...(tipo === "aniversario" && foto ? { foto: foto.chave } : {}) },
      });
      navegar(`/artes/${arte.id}`);
    } catch (e) {
      setErro((e as Error).message);
      setCriando(false);
    }
  }

  return (
    <form onSubmit={criar} className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <h2 className="mr-auto text-[15px] font-semibold">Nova arte</h2>
        <button
          type="button"
          onClick={fechar}
          aria-label="Fechar"
          className="pressiona -mr-1.5 grid size-10 cursor-pointer place-items-center rounded-full text-tinta-2 hover:bg-hover"
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M3 3l8 8M11 3l-8 8" />
          </svg>
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-4 pb-4">
        <p className="text-[13px] text-pretty text-tinta-3">O texto entra na arte exatamente como você escrever, e o logo vai no canto. Campo vazio fica de fora.</p>
        <div className="flex flex-wrap gap-2.5">
          <Segmentado tipo="alternar" rotulo="Tipo de arte" opcoes={TIPOS_DA_TELA} valor={tipo} aoMudar={setTipo} />
          <Segmentado tipo="alternar" rotulo="Formato" opcoes={FORMATOS_DA_TELA} valor={formato} aoMudar={setFormato} />
        </div>

        {campos.map((c, i) => (
          <label key={`${tipo}-${c.nome}`} className="flex flex-col gap-1.5 text-[13px] text-tinta-2">
            <span>
              {c.rotulo}
              {"opcional" in c && <span className="text-tinta-3"> (opcional)</span>}
            </span>
            {"linhas" in c ? (
              <textarea
                value={valores[c.nome] ?? ""}
                onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                maxLength={c.max}
                rows={c.linhas}
                placeholder={c.exemplo}
                className={`${campo} resize-none`}
              />
            ) : (
              <input
                ref={i === 0 ? primeiro : undefined}
                value={valores[c.nome] ?? ""}
                onChange={(e) => setValores((v) => ({ ...v, [c.nome]: e.target.value }))}
                maxLength={c.max}
                placeholder={c.exemplo}
                autoComplete="off"
                className={campo}
              />
            )}
          </label>
        ))}

        {tipo === "aniversario" && (
          <div className="flex flex-col gap-1.5 text-[13px] text-tinta-2">
            <span>
              Foto da pessoa <span className="text-tinta-3">(opcional)</span>
            </span>
            <input ref={seletor} type="file" accept={ACEITOS.join(",")} hidden onChange={(e) => (void escolherFoto(e.currentTarget.files?.[0]), (e.currentTarget.value = ""))} />
            <div className="flex items-center gap-3">
              {foto && <img src={foto.url} alt="Foto escolhida" className="size-16 flex-none rounded-full object-cover outline-1 -outline-offset-1 outline-black/10" />}
              <button
                type="button"
                onClick={() => seletor.current?.click()}
                disabled={subindo}
                className="pressiona cursor-pointer rounded-full bg-linha px-3.5 py-1.5 text-[13px] font-medium hover:bg-linha-forte disabled:cursor-default disabled:opacity-50"
              >
                {subindo ? "Enviando…" : foto ? "Trocar a foto" : "Escolher a foto"}
              </button>
              {foto && (
                <button type="button" onClick={() => setFoto(null)} className="pressiona cursor-pointer rounded-full px-2.5 py-1.5 text-[13px] text-tinta-3 hover:bg-hover hover:text-tinta">
                  Tirar
                </button>
              )}
            </div>
          </div>
        )}

        {erro && <Falha texto="Não deu para criar a arte." erro={erro} />}
        <p role="status" className="text-[13px] text-tinta-3 empty:hidden">
          {criando ? "Criando a arte. Leva uns 30 segundos, e ela abre no editor." : ""}
        </p>
      </div>
      <div className="border-t border-linha px-4 py-3">
        <button
          type="submit"
          disabled={!algum || criando || subindo}
          className="pressiona w-full cursor-pointer rounded-full bg-tinta px-4 py-2.5 font-medium text-sobre-tinta disabled:cursor-default disabled:opacity-50"
        >
          {criando ? "Criando…" : "Criar arte"}
        </button>
      </div>
    </form>
  );
}
