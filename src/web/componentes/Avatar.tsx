import { BOTS, type BotId } from "../bots";
import type { EstadoBot } from "../equipe";

/** O personagem do bot. Trabalhando flutua; esperando ganha o ponto âmbar no canto. Decorativo: o nome vem ao lado. */
export function Avatar({
  bot,
  estado = "parado",
  tamanho,
  anel = "var(--color-painel)",
}: {
  bot: BotId;
  estado?: EstadoBot["tipo"];
  tamanho: number;
  /** Cor da borda do ponto âmbar, igual ao fundo atrás do avatar. */
  anel?: string;
}) {
  const { corpo, cor, giroDoCorpo, olhos: o } = BOTS[bot];
  const ponto = Math.max(8, Math.round(tamanho * 0.3));
  const olho = (x: number, y: number) => (
    <rect
      x={x}
      y={y}
      width={o.largura}
      height={o.altura}
      rx={Math.min(o.largura, o.altura) / 2}
      fill="#ffffff"
      transform={o.giro ? `rotate(${o.giro} ${x + o.largura / 2} ${y + o.altura / 2})` : undefined}
    />
  );
  return (
    <span aria-hidden="true" className="relative inline-grid flex-none place-items-center" style={{ width: tamanho, height: tamanho }}>
      <svg
        width={tamanho}
        height={tamanho}
        viewBox="0 0 100 100"
        className={estado === "trabalhando" ? "flutua overflow-visible" : "overflow-visible"}
      >
        <path d={corpo} fill={cor} transform={giroDoCorpo ? `rotate(${giroDoCorpo} 50 50)` : undefined} />
        {olho(o.x1, o.y1)}
        {olho(o.x2, o.y2)}
      </svg>
      {estado === "esperando" && (
        <span
          className="bg-esperando absolute rounded-full"
          style={{ width: ponto, height: ponto, right: -2, bottom: -2, boxShadow: `0 0 0 2px ${anel}` }}
        />
      )}
    </span>
  );
}
