import { Component, type ErrorInfo, type ReactNode } from "react";
import { BotaoMenu } from "./BotaoMenu";

interface Props {
  /** O nome da tela no texto do aviso: "Não deu para mostrar a atividade." */
  tela: string;
  abrirMenu: () => void;
  children: ReactNode;
}

/**
 * Uma linha com dado torto derruba só a tela em que está, não o app: a barra lateral continua
 * de pé e o aviso oferece tentar de novo. Monte com `key` na rota para zerar ao navegar.
 */
export class LimiteDeErro extends Component<Props, { erro: Error | null }> {
  override state = { erro: null as Error | null };

  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }

  override componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error(erro, info.componentStack);
  }

  override render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;
    return (
      <main id="conteudo" className="flex min-w-0 flex-1 flex-col px-4 pt-3 sm:px-6">
        <BotaoMenu abrir={this.props.abrirMenu} />
        <div role="alert" className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 pb-16 text-center">
          <h1 className="text-lg font-semibold text-balance">Não deu para mostrar {this.props.tela}.</h1>
          <p className="text-pretty text-tinta-2">Algum dado chegou num formato que esta tela não esperava. O resto do app continua funcionando.</p>
          <p className="max-w-full font-mono text-xs text-tinta-3 [overflow-wrap:anywhere]">{erro.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ erro: null })}
            className="pressiona cursor-pointer rounded-full bg-tinta px-4 py-2 font-medium text-sobre-tinta"
          >
            Tentar de novo
          </button>
        </div>
      </main>
    );
  }
}
