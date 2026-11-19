import { useState } from "react";
import { FORMATOS, PROPORCAO_DO_LOGO, type Camada } from "../../../v2/camadas";
import { apiArtes, type ArteDaApi } from "../../api";
import { descricaoDa, TIPO } from "./textos";

export function ListaDeCamadas(props: {
  arteId: string;
  camadas: Camada[];
  selecionada: string | null;
  selecionar: (id: string) => void;
  acrescentar: (c: Camada) => void;
  formato: ArteDaApi["formato"];
}) {
  const { largura, altura } = FORMATOS[props.formato];
  const novoId = () => crypto.randomUUID().slice(0, 8);
  const novoTexto = (): Camada => ({
    id: novoId(),
    tipo: "texto",
    texto: "Texto novo",
    fonte: "Poppins",
    peso: 500,
    tamanho: 40,
    entrelinha: 1.3,
    cor: "#414141",
    alinhamento: "esquerda",
    x: 80,
    y: Math.round(altura / 2),
    largura: largura - 160,
  });
  const novaFaixa = (): Camada => ({ id: novoId(), tipo: "forma", cor: "#2F646A", x: 0, y: altura - 320, largura, altura: 320, raio: 0 });
  const LARGURA_DO_LOGO = 200;
  const novoLogo = (): Camada => ({
    id: novoId(),
    tipo: "logo",
    variante: "cor",
    x: largura - 64 - LARGURA_DO_LOGO,
    y: Math.round(altura - (props.formato === "story" ? 360 : 64) - LARGURA_DO_LOGO * PROPORCAO_DO_LOGO),
    largura: LARGURA_DO_LOGO,
  });
  const [envio, setEnvio] = useState<{ tipo: "parado" } | { tipo: "enviando" } | { tipo: "erro"; mensagem: string }>({ tipo: "parado" });
  async function enviarImagem(arquivo: File | undefined) {
    if (!arquivo) return;
    setEnvio({ tipo: "enviando" });
    try {
      const { chave, proporcao } = await apiArtes.enviarImagem(props.arteId, arquivo);
      // Entra centralizada, com 40% da largura da arte e sem passar da altura dela.
      const larguraDaImagem = Math.round(Math.min(largura * 0.4, (altura * 0.6) / proporcao));
      props.acrescentar({
        id: novoId(),
        tipo: "imagem",
        chave,
        proporcao,
        largura: larguraDaImagem,
        x: Math.round((largura - larguraDaImagem) / 2),
        y: Math.round((altura - larguraDaImagem * proporcao) / 2),
      });
      setEnvio({ tipo: "parado" });
    } catch (e) {
      setEnvio({ tipo: "erro", mensagem: (e as Error).message });
    }
  }
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <h2 className="mr-auto text-xs text-tinta-3">Camadas</h2>
        <button type="button" aria-label="Adicionar texto" onClick={() => props.acrescentar(novoTexto())} className={BOTAO_PEQUENO}>
          + Texto
        </button>
        <button type="button" aria-label="Adicionar faixa" onClick={() => props.acrescentar(novaFaixa())} className={BOTAO_PEQUENO}>
          + Faixa
        </button>
        <button type="button" aria-label="Adicionar logo oficial" onClick={() => props.acrescentar(novoLogo())} className={BOTAO_PEQUENO}>
          + Logo
        </button>
        <label className={`${BOTAO_PEQUENO} focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-tinta ${envio.tipo === "enviando" ? "pointer-events-none opacity-50" : ""}`}>
          {envio.tipo === "enviando" ? "Enviando…" : "+ Imagem"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg"
            aria-label="Adicionar imagem ou SVG"
            className="sr-only"
            disabled={envio.tipo === "enviando"}
            onChange={(e) => {
              void enviarImagem(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      {envio.tipo === "erro" && (
        <p role="alert" className="text-[13px] text-erro">
          Não deu para enviar a imagem: {envio.mensagem}
        </p>
      )}
      <ul className="flex flex-col gap-0.5">
        {[...props.camadas].reverse().map((c) => (
          <li key={c.id}>
            <button
              type="button"
              aria-pressed={c.id === props.selecionada}
              onClick={() => props.selecionar(c.id)}
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-item px-2.5 py-2 text-left text-sm hover:bg-hover aria-pressed:bg-ativo"
            >
              <span className="w-12 flex-none text-[11px] text-tinta-3">{TIPO[c.tipo]}</span>
              <span className="min-w-0 truncate">{descricaoDa(c)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const BOTAO_PEQUENO = "pressiona cursor-pointer rounded-full bg-linha px-3 py-1 text-[13px] font-medium hover:bg-linha-forte";

