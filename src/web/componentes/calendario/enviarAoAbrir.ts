/**
 * Manda `texto` como primeira mensagem da conversa que acabou de abrir, pelo próprio composer
 * da tela de conversa: o envio passa pelo mesmo caminho de quando a pessoa digita.
 *
 * A tela de conversa não recebe um pedido inicial por prop, e mudá-la estava fora do escopo
 * do calendário. Quando ela ganhar essa prop, isto vira um argumento na navegação.
 */
export function enviarAoAbrir(conversaId: string, texto: string, espera = 8000) {
  const caminho = `/c/${conversaId}`;
  const inicio = performance.now();
  const tentar = () => {
    if (location.pathname !== caminho || performance.now() - inicio > espera) return;
    const campo = document.querySelector<HTMLTextAreaElement>("textarea#mensagem");
    if (!campo?.form) return void requestAnimationFrame(tentar);
    // O React só vê a mudança se o valor passar pelo setter nativo antes do evento de input.
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(campo, texto);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    requestAnimationFrame(() => campo.form?.requestSubmit());
  };
  requestAnimationFrame(tentar);
}
