import { useEffect, useState } from "react";
import { auth } from "../auth";

/** O better-auth volta para /entrar?error=... quando o Google recusa ou o e-mail não é da empresa. */
function mensagemDoErro(codigo: string | null): string | null {
  if (!codigo) return null;
  if (/access_denied/i.test(codigo)) return "O login com o Google foi cancelado. Tente de novo.";
  if (/forbidden|unable_to_create_user|user/i.test(codigo)) return "Só e-mails @emvidros.com.br entram. Use a conta Google da empresa.";
  return "Não deu para entrar agora. Tente de novo em instantes.";
}

function IconeGoogle() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 48 48">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function Entrar() {
  const [erro, setErro] = useState(() => mensagemDoErro(new URLSearchParams(location.search).get("error")));
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    document.title = "Entrar · EM Marketing";
  }, []);

  async function entrar() {
    if (enviando) return;
    setEnviando(true);
    setErro(null);
    const { error } = await auth.signIn
      .social({ provider: "google", callbackURL: "/", errorCallbackURL: "/entrar" })
      .catch(() => ({ error: { status: 0 } }));
    if (error) {
      setEnviando(false);
      setErro(error.status === 0 ? "Sem conexão com o servidor. Confira a internet e tente de novo." : "Não deu para abrir o login do Google agora. Tente de novo.");
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-6">
      <div className="flex w-full max-w-[360px] flex-col gap-4">
        <div className="mb-3 flex flex-col items-center gap-2.5 text-center">
          <img src="/logo/emvidros-oficial.svg" alt="EM Vidros" width={76} height={63} className="h-[63px] w-auto" />
          <h1 className="mt-1.5 text-[28px]/[1.1] font-semibold tracking-[-0.025em]">EM Marketing</h1>
          <p className="text-tinta-3">Entre com a sua conta Google da EM Vidros.</p>
        </div>
        <button
          type="button"
          onClick={entrar}
          aria-busy={enviando}
          className="pressiona mt-1 flex cursor-pointer items-center justify-center gap-2.5 rounded-full bg-tinta px-[18px] py-3 text-[15px] font-medium text-sobre-tinta aria-busy:opacity-60"
        >
          <span className="grid size-6 place-items-center rounded-full bg-white">
            <IconeGoogle />
          </span>
          {enviando ? "Abrindo o Google…" : "Entrar com Google"}
        </button>
        <p role="status" className="text-erro text-center text-[13px] empty:hidden">
          {erro}
        </p>
      </div>
    </main>
  );
}
