import { auth } from "../auth";
import { aoClicarLink } from "../rota";
import { ariaDe, ehMac } from "../teclado/atalhos";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../shadcn/ui/dropdown-menu";
import { SaldoCompacto } from "./Saldo";
import { Teclas } from "./menu/Teclas";

const DESTINOS = [
  { caminho: "/atividade", nome: "Atividade", atalho: "ir-atividade" },
  { caminho: "/biblioteca", nome: "Biblioteca", atalho: "ir-biblioteca" },
  { caminho: "/calendario", nome: "Calendário", atalho: "ir-calendario" },
] as const;

/** O canto de baixo da barra: o perfil abre o que não é conversa nem bot. */
export function MenuDoPerfil({
  email,
  telaAtual,
  emAtividade,
  abrirAtalhos,
  aoNavegar,
}: {
  email: string;
  telaAtual: string;
  emAtividade: number;
  abrirAtalhos: () => void;
  aoNavegar: () => void;
}) {
  const nome = email.split("@")[0] ?? email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Menu de ${email}`}
        className="pressiona relative flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-item px-2 text-left text-sm outline-none hover:bg-hover data-popup-open:bg-hover"
      >
        <span aria-hidden="true" className="grid size-7 flex-none place-items-center rounded-full bg-preenchimento text-xs font-medium uppercase">
          {nome.slice(0, 2)}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{nome}</span>
        {emAtividade > 0 && <span className="tabular font-mono text-xs text-tinta-2">{emAtividade}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" sideOffset={6} className="w-64 p-1.5">
        <div className="truncate px-2 pt-1 pb-2 text-xs text-tinta-3">{email}</div>
        {DESTINOS.map((d) => (
          <DropdownMenuItem
            key={d.caminho}
            render={<a href={d.caminho} aria-current={telaAtual === d.caminho ? "page" : undefined} onClick={(e) => (aoClicarLink(e), aoNavegar())} />}
            className="h-9 justify-between px-2"
          >
            {d.nome}
            {d.caminho === "/atividade" && emAtividade > 0 ? <span className="tabular font-mono text-xs">{emAtividade}</span> : <Teclas atalho={d.atalho} />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onClick={abrirAtalhos} aria-keyshortcuts={ariaDe("atalhos", ehMac)} className="h-9 justify-between px-2">
          Atalhos de teclado
          <Teclas atalho="atalhos" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          render={<a href="/uso" aria-label="Crédito OpenAI e uso da API" onClick={(e) => (aoClicarLink(e), aoNavegar())} />}
          className="px-2 py-2"
        >
          <SaldoCompacto />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => auth.signOut()} className="h-9 px-2">
          Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
