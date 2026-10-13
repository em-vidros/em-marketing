import { BotaoMenu } from "../componentes/BotaoMenu";
import { useEffect } from "react";

/**
 * Espaço reservado. Outra frente constrói esta tela (canvas: Atividade.dc.html); o Shell já
 * a monta com a barra lateral ao lado. `abrirMenu` abre a barra no celular.
 */
export function Atividade({ abrirMenu }: { abrirMenu: () => void }) {
  useEffect(() => {
    document.title = "Atividade · EM Marketing";
  }, []);
  return (
    <main id="conteudo" className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <BotaoMenu abrir={abrirMenu} />
        <h1 className="text-lg font-semibold tracking-[-0.01em]">Atividade</h1>
      </header>
      <p className="px-6 text-tinta-3">Em construção.</p>
    </main>
  );
}
