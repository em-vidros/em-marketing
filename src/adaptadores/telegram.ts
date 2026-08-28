/**
 * Porta do Telegram, portada de `src/telegram/api.ts` para `Buffer`.
 *
 * O v1 mandava caminho de arquivo, o que amarrava o bot ao disco local. Aqui entram
 * bytes, porque o artefato é endereçado por conteúdo e pode vir de qualquer lugar.
 *
 * Nenhuma mensagem de erro carrega a URL: o token está dentro dela, e log de erro é
 * exatamente o lugar por onde um token vaza. O que sai no erro é o método e a
 * `description` da API. Bytes de imagem também nunca são logados (PRD §4.11).
 */

import type { PortaTelegram } from "./tipos";

/** Exportado para o arnês conferir a URL sem repetir o host fora deste diretório. */
export const BASE_TELEGRAM = "https://api.telegram.org";
const MAX_ALBUM = 10;

export type Buscador = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function campo(bruto: unknown, nome: string): unknown {
  if (typeof bruto !== "object" || bruto === null) return undefined;
  return Reflect.get(bruto, nome);
}

function exigirTexto(valor: unknown, onde: string): string {
  if (typeof valor !== "string" || valor === "")
    throw new Error(`Telegram ${onde}: esperava texto e veio ${valor === undefined ? "nada" : typeof valor}.`);
  return valor;
}

function exigirNumero(valor: unknown, onde: string): number {
  if (typeof valor !== "number" || !Number.isFinite(valor))
    throw new Error(`Telegram ${onde}: esperava número e veio ${valor === undefined ? "nada" : typeof valor}.`);
  return valor;
}

/** O Telegram deduz o tipo pelo nome do arquivo, mas o Blob sem tipo vira octet-stream. */
function mediaTipoDoNome(nome: string): string {
  const extensao = nome.slice(nome.lastIndexOf(".") + 1).toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      txt: "text/plain",
      md: "text/markdown",
    }[extensao] ?? "application/octet-stream"
  );
}

function parte(bytes: Buffer, mediaTipo: string): Blob {
  return new Blob([new Uint8Array(bytes)], { type: mediaTipo });
}

export class TelegramReal implements PortaTelegram {
  constructor(
    private readonly token: string,
    private readonly buscar: Buscador = globalThis.fetch,
  ) {}

  private async chamar(
    metodo: string,
    corpo: string | FormData,
    cabecalhos?: Record<string, string>,
  ): Promise<unknown> {
    const resposta = await this.buscar(`${BASE_TELEGRAM}/bot${this.token}/${metodo}`, {
      method: "POST",
      body: corpo,
      ...(cabecalhos ? { headers: cabecalhos } : {}),
    });

    let json: unknown;
    try {
      json = await resposta.json();
    } catch {
      throw new Error(`Telegram ${metodo}: resposta não é JSON (HTTP ${resposta.status}).`);
    }

    if (campo(json, "ok") !== true) {
      const descricao = campo(json, "description");
      throw new Error(
        `Telegram ${metodo}: ${typeof descricao === "string" ? descricao : `HTTP ${resposta.status} sem description`}`,
      );
    }
    return campo(json, "result");
  }

  private chamarJson(metodo: string, corpo: Record<string, unknown>): Promise<unknown> {
    return this.chamar(metodo, JSON.stringify(corpo), { "content-type": "application/json" });
  }

  /** Multipart não carrega tipo: valor que não é texto vai serializado, como no v1. */
  private formulario(chatId: number, extra?: Record<string, unknown>): FormData {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    for (const [chave, valor] of Object.entries(extra ?? {}))
      form.append(chave, typeof valor === "string" ? valor : JSON.stringify(valor));
    return form;
  }

  /**
   * Texto puro por padrão. O Markdown legado rejeita a mensagem inteira com um `_`
   * desbalanceado, e quase tudo que passa aqui é texto livre de modelo. Quem escreve
   * marcação passa `parse_mode` no `extra`.
   */
  async enviarMensagem(
    chatId: number,
    texto: string,
    extra?: Record<string, unknown>,
  ): Promise<{ message_id: number }> {
    const resultado = await this.chamarJson("sendMessage", { chat_id: chatId, text: texto, ...extra });
    return { message_id: exigirNumero(campo(resultado, "message_id"), "sendMessage.result.message_id") };
  }

  async enviarAlbum(
    chatId: number,
    jpegs: readonly Buffer[],
    caption?: string,
  ): Promise<{ message_ids: number[] }> {
    if (jpegs.length === 0) throw new Error("Telegram sendMediaGroup: álbum sem nenhuma foto.");
    if (jpegs.length > MAX_ALBUM)
      throw new Error(`Telegram sendMediaGroup: ${jpegs.length} fotos, e a API aceita no máximo ${MAX_ALBUM}.`);

    const form = this.formulario(chatId);
    form.append(
      "media",
      JSON.stringify(
        // Caption só na primeira: no álbum ela vira a legenda do grupo inteiro, e
        // repetida em cada item o Telegram mostra o texto N vezes.
        jpegs.map((_, i) => ({
          type: "photo",
          media: `attach://f${i}`,
          ...(i === 0 && caption ? { caption } : {}),
        })),
      ),
    );
    jpegs.forEach((jpeg, i) => form.append(`f${i}`, parte(jpeg, "image/jpeg"), `v${i + 1}.jpg`));

    const resultado = await this.chamar("sendMediaGroup", form);
    if (!Array.isArray(resultado)) throw new Error("Telegram sendMediaGroup: result não é lista.");
    return {
      message_ids: resultado.map((m, i) =>
        exigirNumero(campo(m, "message_id"), `sendMediaGroup.result[${i}].message_id`),
      ),
    };
  }

  async enviarFoto(
    chatId: number,
    jpeg: Buffer,
    extra?: Record<string, unknown>,
  ): Promise<{ message_id: number }> {
    const form = this.formulario(chatId, extra);
    form.append("photo", parte(jpeg, "image/jpeg"), "previa.jpg");
    const resultado = await this.chamar("sendPhoto", form);
    return { message_id: exigirNumero(campo(resultado, "message_id"), "sendPhoto.result.message_id") };
  }

  async enviarDocumento(
    chatId: number,
    arquivo: Buffer,
    nome: string,
    extra?: Record<string, unknown>,
  ): Promise<{ message_id: number; file_id: string }> {
    const form = this.formulario(chatId, extra);
    form.append("document", parte(arquivo, mediaTipoDoNome(nome)), nome);
    const resultado = await this.chamar("sendDocument", form);
    return {
      message_id: exigirNumero(campo(resultado, "message_id"), "sendDocument.result.message_id"),
      file_id: exigirTexto(
        campo(campo(resultado, "document"), "file_id"),
        "sendDocument.result.document.file_id",
      ),
    };
  }

  async obterArquivo(fileId: string): Promise<{ file_path: string }> {
    const resultado = await this.chamarJson("getFile", { file_id: fileId });
    return { file_path: exigirTexto(campo(resultado, "file_path"), "getFile.result.file_path") };
  }

  async baixarArquivo(filePath: string): Promise<Buffer> {
    const resposta = await this.buscar(`${BASE_TELEGRAM}/file/bot${this.token}/${filePath}`);
    if (!resposta.ok)
      throw new Error(`Telegram baixarArquivo: HTTP ${resposta.status} em ${filePath}`);
    return Buffer.from(await resposta.arrayBuffer());
  }

  async responderCallback(callbackId: string, texto?: string): Promise<void> {
    try {
      await this.chamarJson("answerCallbackQuery", { callback_query_id: callbackId, text: texto });
    } catch {
      // Callback vencido é o caso normal quando o Ricardo toca duas vezes, e não
      // pode derrubar o tratamento do update que já foi aceito.
    }
  }
}
