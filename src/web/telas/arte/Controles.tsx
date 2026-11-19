import { FONTES, transformacaoDa, type Camada, type Fonte } from "../../../v2/camadas";
import { Segmentado } from "../../componentes/Segmentado";
import { Campo, Cor, Numero } from "./Campos";
import { TIPO } from "./textos";

export function Controles({ camada: c, mudar, remover }: { camada: Camada; mudar: (c: Camada) => void; remover: () => void }) {
  const { rotacao, opacidade } = transformacaoDa(c);
  const posicao = (
    <div className="grid grid-cols-3 gap-2">
      <Numero rotulo="X" valor={c.x} min={-2000} max={4000} aoMudar={(x) => mudar({ ...c, x })} />
      <Numero rotulo="Y" valor={c.y} min={-2000} max={4000} aoMudar={(y) => mudar({ ...c, y })} />
      <Numero rotulo="Largura" valor={c.largura} min={20} max={4000} aoMudar={(largura) => mudar({ ...c, largura })} />
    </div>
  );
  return (
    <section aria-label={`Editar ${TIPO[c.tipo].toLowerCase()}`} className="flex flex-col gap-4 border-t border-linha pt-4">
      {c.tipo === "texto" && <ControlesDeTexto camada={c} mudar={mudar} />}
      {c.tipo === "logo" && (
        <Segmentado
          tipo="alternar"
          rotulo="Versão do logo"
          opcoes={[
            { valor: "cor", rotulo: "Colorido" },
            { valor: "branca", rotulo: "Branco" },
          ]}
          valor={c.variante}
          aoMudar={(variante) => mudar({ ...c, variante })}
        />
      )}
      {c.tipo === "forma" && <Cor valor={c.cor} aoMudar={(cor) => mudar({ ...c, cor })} />}
      {posicao}
      {c.tipo === "forma" && (
        <div className="grid grid-cols-2 gap-2">
          <Numero rotulo="Altura" valor={c.altura} min={1} max={4000} aoMudar={(altura) => mudar({ ...c, altura })} />
          <Numero rotulo="Arredondamento" valor={c.raio} min={0} max={12} aoMudar={(raio) => mudar({ ...c, raio })} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Numero rotulo="Rotação (graus)" valor={rotacao} min={-180} max={180} passo={0.1} aoMudar={(v) => mudar({ ...c, rotacao: v })} />
        <Numero rotulo="Opacidade (%)" valor={Math.round(opacidade * 100)} min={0} max={100} aoMudar={(v) => mudar({ ...c, opacidade: v / 100 })} />
      </div>
      <button type="button" onClick={remover} className="pressiona cursor-pointer self-start rounded-full px-3 py-1.5 text-[13px] font-medium text-erro hover:bg-hover">
        Remover {TIPO[c.tipo].toLowerCase()}
      </button>
    </section>
  );
}

function ControlesDeTexto({ camada: c, mudar }: { camada: Extract<Camada, { tipo: "texto" }>; mudar: (c: Camada) => void }) {
  return (
    <>
      <Campo rotulo="Texto">
        {(id) => (
          <textarea
            id={id}
            value={c.texto}
            rows={3}
            maxLength={400}
            onChange={(e) => mudar({ ...c, texto: e.target.value })}
            className="w-full resize-none rounded-item border border-borda-campo bg-transparent px-3 py-2 text-sm"
          />
        )}
      </Campo>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <Campo rotulo="Fonte">
          {(id) => (
            <select
              id={id}
              value={c.fonte}
              onChange={(e) => {
                const fonte = e.target.value as Fonte;
                mudar({ ...c, fonte, peso: Number(Object.keys(FONTES[fonte])[0]) });
              }}
              className="w-full cursor-pointer rounded-item border border-borda-campo bg-transparent px-2.5 py-2 text-sm"
            >
              {Object.keys(FONTES).map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          )}
        </Campo>
        <Campo rotulo="Peso">
          {(id) => (
            <select
              id={id}
              value={c.peso}
              onChange={(e) => mudar({ ...c, peso: Number(e.target.value) })}
              className="cursor-pointer rounded-item border border-borda-campo bg-transparent px-2.5 py-2 text-sm tabular"
            >
              {Object.keys(FONTES[c.fonte]).map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          )}
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Numero rotulo="Tamanho" valor={c.tamanho} min={12} max={400} aoMudar={(tamanho) => mudar({ ...c, tamanho })} />
        <Numero rotulo="Entrelinha" valor={c.entrelinha} min={0.8} max={2.5} passo={0.05} aoMudar={(entrelinha) => mudar({ ...c, entrelinha })} />
      </div>
      <Cor valor={c.cor} aoMudar={(cor) => mudar({ ...c, cor })} />
      <Segmentado
        tipo="alternar"
        rotulo="Alinhamento"
        opcoes={[
          { valor: "esquerda", rotulo: "Esquerda" },
          { valor: "centro", rotulo: "Centro" },
          { valor: "direita", rotulo: "Direita" },
        ]}
        valor={c.alinhamento}
        aoMudar={(alinhamento) => mudar({ ...c, alinhamento })}
      />
    </>
  );
}

