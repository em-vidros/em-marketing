import { useRef, useState, type FormEvent } from "react";
import { auth } from "../auth";
import { navegar } from "../rota";

/** better-auth não diz se o e-mail existe; o usuário vê a mesma mensagem nos dois casos. */
function mensagemDoErro(status: number | undefined): string {
  if (status === 401 || status === 403) return "E-mail sem acesso ou senha errada.";
  if (status === 429) return "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
  if (status === undefined || status === 0) return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  return "Não deu para entrar agora. Tente de novo em instantes.";
}

export function Entrar() {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const email = useRef<HTMLInputElement>(null);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (enviando) return;
    const dados = new FormData(e.currentTarget);
    setEnviando(true);
    setErro(null);
    const { error } = await auth.signIn
      .email({ email: String(dados.get("email")).trim(), password: String(dados.get("senha")) })
      .catch(() => ({ error: { status: undefined } }));
    setEnviando(false);
    if (!error) return navegar("/", { substituir: true });
    setErro(mensagemDoErro(error.status));
    email.current?.focus();
  }

  const campo =
    "w-full rounded-full border border-linha-forte bg-superficie px-[18px] py-3 text-base text-tinta outline-none transition-[border-color] duration-150 focus-visible:border-tinta focus-visible:outline-none aria-invalid:border-erro sm:text-[15px]";

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-6">
      <form onSubmit={enviar} noValidate className="flex w-full max-w-[360px] flex-col gap-4">
        <div className="mb-3 flex flex-col items-center gap-2.5 text-center">
          <img src="/logo/emvidros-oficial.svg" alt="EM Vidros" width={76} height={63} className="h-[63px] w-auto" />
          <h1 className="mt-1.5 text-[28px]/[1.1] font-semibold tracking-[-0.025em]">EM Marketing</h1>
          <p className="text-tinta-3">Entre com o e-mail liberado pela equipe.</p>
        </div>
        <label htmlFor="email" className="sr-only">
          E-mail
        </label>
        <input
          ref={email}
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          required
          placeholder="E-mail"
          aria-invalid={erro ? true : undefined}
          aria-describedby="entrar-erro"
          className={campo}
        />
        <label htmlFor="senha" className="sr-only">
          Senha
        </label>
        <input
          id="senha"
          name="senha"
          type="password"
          autoComplete="current-password"
          required
          placeholder="Senha"
          aria-invalid={erro ? true : undefined}
          aria-describedby="entrar-erro"
          className={campo}
        />
        <p id="entrar-erro" role="status" className="text-erro text-[13px] empty:-mt-4">
          {erro}
        </p>
        <button
          type="submit"
          aria-busy={enviando}
          className="pressiona mt-1 cursor-pointer rounded-full bg-tinta px-[18px] py-3 text-[15px] font-medium text-sobre-tinta transition-opacity duration-150 aria-busy:opacity-60"
        >
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
