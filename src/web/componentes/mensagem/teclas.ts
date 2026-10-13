import { acorde, ATALHOS, type AtalhoId, ehMac, sequencia, type Tecla } from "../../teclado/atalhos";

/** A tecla aperta um atalho de um acorde só. Para quem trata a tecla fora do despachante (menus, composer). */
export const casa = (id: AtalhoId, e: Tecla, mac = ehMac) => {
  const c = acorde(e, mac);
  return ATALHOS[id].teclas.some((t) => sequencia(t).join(" ") === c);
};

/** ↑ no composer vazio edita a sua última mensagem, como no Slack e no Linear. Com texto, ↑ só move o cursor. */
export const editaAoSubir = (e: Tecla, texto: string, mac = ehMac) => texto.length === 0 && casa("mensagem-editar-ultima", e, mac);
