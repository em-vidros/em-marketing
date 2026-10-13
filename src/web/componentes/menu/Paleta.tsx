import { Dialog } from "@base-ui/react/dialog";
import { Command } from "cmdk";
import { useState, type ReactNode } from "react";
import type { NomesDosBots } from "../../api";
import { BOT_IDS } from "../../bots";
import { navegar } from "../../rota";
import { type AtalhoId, atalhoDeConversa, atalhoDoBot, rotuloDe } from "../../teclado/atalhos";
import { estaLigado, executar, useLigados } from "../../teclado/motor";
import type { Conversa } from "../../tipos";
import { Avatar } from "../Avatar";
import type { AcoesConversa } from "./MenuConversa";
import { Teclas } from "./Teclas";

export type ModoPaleta = "tudo" | "conversas";

/**
 * A paleta ⌘K. Os grupos seguem o Linear: primeiro o que vale para a tela aberta, depois
 * ações, bots, conversas e navegação. Cada linha mostra a tecla da tabela de atalhos.
 * Abre sem animação: é a ação mais repetida do app e nasce do teclado.
 */
export function Paleta({
  modo,
  fechar,
  conversas,
  aberta,
  acoes,
  bots,
}: {
  modo: ModoPaleta | null;
  fechar: () => void;
  conversas: readonly Conversa[];
  /** A conversa da tela, para o grupo contextual. */
  aberta: Conversa | null;
  acoes: AcoesConversa;
  bots: NomesDosBots;
}) {
  const [busca, setBusca] = useState("");
  // As ações listadas dependem do que está ligado agora (⌘I só existe com a conversa aberta).
  useLigados();
  const so = modo === "conversas";
  // Roda depois de fechar, para a ação achar o foco e a tela de antes.
  const rodar = (fazer: () => void) => {
    fechar();
    requestAnimationFrame(fazer);
  };
  const acao = (id: AtalhoId, rotulo = rotuloDe(id, bots)) =>
    estaLigado(id) && (
      <Linha key={id} valor={`acao ${id}`} palavras={[rotulo]} atalho={id} aoEscolher={() => rodar(() => executar(id))}>
        {rotulo}
      </Linha>
    );
  const recentes = busca ? conversas : conversas.filter((c) => c.arquivadaEm === null).slice(0, 6);

  return (
    <Dialog.Root open={modo !== null} onOpenChange={(a) => !a && fechar()} onOpenChangeComplete={(a) => !a && setBusca("")}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-[70] bg-tinta/16" />
        <Dialog.Popup
          data-teclado="isolado"
          aria-label={so ? "Buscar conversas" : "Paleta de comandos"}
          className="fixed top-[max(16px,12vh)] left-1/2 z-[71] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-[20px] border border-linha bg-superficie shadow-[0_24px_64px_rgb(15_13_10/0.18),0_2px_6px_rgb(15_13_10/0.06)] outline-none"
        >
          <Command label={so ? "Buscar conversas" : "Paleta de comandos"} loop filter={filtrar}>
            <div className="flex items-center gap-3 border-b border-linha px-5">
              <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="flex-none text-tinta-3">
                <circle cx="7" cy="7" r="4.75" />
                <path d="M10.5 10.5 14 14" strokeLinecap="round" />
              </svg>
              <Command.Input
                value={busca}
                onValueChange={setBusca}
                placeholder={so ? "Buscar conversas…" : "O que você quer fazer?"}
                className="h-14 min-w-0 flex-1 bg-transparent text-base outline-none sm:text-[15px]"
              />
              <Teclas tecla="escape" />
            </div>
            <Command.List className="max-h-[min(440px,60dvh)] scroll-py-2 overflow-y-auto overscroll-contain p-2">
              <Command.Empty className="px-3 py-8 text-center text-tinta-3">Nada encontrado para “{busca}”.</Command.Empty>

              {!so && aberta && (
                <Grupo titulo="Esta conversa">
                  <Linha valor="contexto renomear" palavras={["Renomear conversa", aberta.titulo]} atalho="conversa-renomear" aoEscolher={() => rodar(() => acoes.renomear(aberta.id))}>
                    Renomear conversa
                  </Linha>
                  <Linha
                    valor="contexto arquivar"
                    palavras={[aberta.arquivadaEm === null ? "Arquivar conversa" : "Desarquivar conversa"]}
                    atalho="conversa-arquivar"
                    aoEscolher={() => rodar(() => acoes.arquivar(aberta.id, aberta.arquivadaEm === null))}
                  >
                    {aberta.arquivadaEm === null ? "Arquivar conversa" : "Desarquivar conversa"}
                  </Linha>
                  <Linha valor="contexto excluir" palavras={["Excluir conversa", "apagar"]} atalho="conversa-excluir" aoEscolher={() => rodar(() => acoes.excluir(aberta.id))}>
                    Excluir conversa
                  </Linha>
                  {acao("painel-tarefas")}
                </Grupo>
              )}

              {!so && (
                <Grupo titulo="Ações">
                  {acao("nova-conversa")}
                  {acao("focar-composer")}
                  {acao("buscar")}
                  {acao("desfazer")}
                  {acao("config-bot")}
                  {acao("barra-lateral")}
                  {acao("atalhos")}
                </Grupo>
              )}

              {!so && (
                <Grupo titulo="Bots">
                  {BOT_IDS.map((id) => (
                    <Linha
                      key={id}
                      valor={`bot ${id}`}
                      palavras={[bots[id].nome, bots[id].descricao, "bot"]}
                      atalho={atalhoDoBot(id)}
                      aoEscolher={() => rodar(() => navegar(`/bots/${id}`))}
                    >
                      <Avatar bot={id} tamanho={20} />
                      <span className="truncate">
                        {bots[id].nome}
                        <span className="ml-2 text-tinta-3 max-sm:hidden">{bots[id].descricao}</span>
                      </span>
                    </Linha>
                  ))}
                </Grupo>
              )}

              {!so && (
                <Grupo titulo="Nova conversa">
                  {BOT_IDS.map((id) => {
                    const atalho = atalhoDeConversa(id);
                    const rotulo = rotuloDe(atalho, bots);
                    return (
                      <Linha key={id} valor={`conversar ${id}`} palavras={[rotulo, bots[id].nome, "conversa", "pedido"]} atalho={atalho} aoEscolher={() => rodar(() => executar(atalho))}>
                        <Avatar bot={id} tamanho={20} />
                        <span className="truncate">{rotulo}</span>
                      </Linha>
                    );
                  })}
                </Grupo>
              )}

              {recentes.length > 0 && (
                <Grupo titulo={busca ? "Conversas" : "Conversas recentes"}>
                  {recentes.map((c) => (
                    <Linha key={c.id} valor={`conversa ${c.id}`} palavras={[c.titulo]} aoEscolher={() => rodar(() => navegar(`/c/${c.id}`))}>
                      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="flex-none text-tinta-3">
                        <path d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7l-3 2.5v-2.5h0a2 2 0 0 1-1.5-2z" strokeLinejoin="round" />
                      </svg>
                      <span className="truncate">{c.titulo}</span>
                      {c.arquivadaEm !== null && <span className="flex-none text-xs text-tinta-3">Arquivada</span>}
                    </Linha>
                  ))}
                </Grupo>
              )}

              {!so && (
                <Grupo titulo="Navegação">
                  {acao("ir-atividade")}
                  {acao("ir-biblioteca")}
                </Grupo>
              )}
            </Command.List>
          </Command>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/**
 * Cada palavra buscada tem de aparecer no começo de alguma palavra do rótulo. O filtro
 * difuso do cmdk achava "Renomear conversa" para "ativ", letra a letra.
 */
function filtrar(_valor: string, busca: string, palavras: string[] = []) {
  const alvo = normalizar(palavras.join(" ")).split(/[^\p{L}\p{N}]+/u);
  const termos = normalizar(busca).split(/\s+/).filter(Boolean);
  if (!termos.every((t) => alvo.some((p) => p.startsWith(t)))) return 0;
  return termos.some((t) => alvo.includes(t)) ? 1 : 0.5;
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Command.Group
      heading={titulo}
      className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-tinta-3"
    >
      {children}
    </Command.Group>
  );
}

function Linha({ valor, palavras, atalho, aoEscolher, children }: { valor: string; palavras: string[]; atalho?: AtalhoId; aoEscolher: () => void; children: ReactNode }) {
  return (
    <Command.Item
      value={valor}
      keywords={palavras}
      onSelect={aoEscolher}
      className="linha-paleta relative flex h-10 cursor-pointer items-center gap-3 rounded-item px-3 text-tinta-2 select-none data-[selected=true]:bg-hover data-[selected=true]:text-tinta max-md:h-11"
    >
      {children}
      {atalho && (
        <span className="ml-auto pl-3">
          <Teclas atalho={atalho} />
        </span>
      )}
    </Command.Item>
  );
}
