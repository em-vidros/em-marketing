/**
 * Porta do Linear, portada de `src/linear/index.ts` para `Buffer` e mediaTipo.
 *
 * Time e label entram pelo construtor: o v1 tinha o uuid do time em literal no meio
 * do módulo, o que fazia trocar de time exigir commit. Quem sabe qual time é o certo
 * é quem monta os adaptadores.
 */

import type { PortaLinear } from "./tipos";

const API = "https://api.linear.app/graphql";

/** Time EM Vidros, o único que existe hoje; `LINEAR_TEAM_ID` sobrescreve. */
export const TIME_EM_VIDROS = "ec0c88f8-96c2-40b2-853c-98f62b4d98fa";

export type Buscador = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

function campo(bruto: unknown, nome: string): unknown {
  if (typeof bruto !== "object" || bruto === null) return undefined;
  return Reflect.get(bruto, nome);
}

function caminho(bruto: unknown, trilha: string): unknown {
  let atual = bruto;
  for (const passo of trilha.split(".")) atual = campo(atual, passo);
  return atual;
}

function exigirTexto(bruto: unknown, trilha: string): string {
  const valor = caminho(bruto, trilha);
  if (typeof valor !== "string" || valor === "")
    throw new Error(`Linear: resposta sem ${trilha}.`);
  return valor;
}

export class LinearReal implements PortaLinear {
  private readonly chave: string;
  private readonly teamId: string;
  private readonly labelId: string;
  private readonly buscar: Buscador;

  constructor(e: { chave: string; teamId: string; labelId: string; buscar?: Buscador }) {
    this.chave = e.chave;
    this.teamId = e.teamId;
    this.labelId = e.labelId;
    this.buscar = e.buscar ?? globalThis.fetch;
  }

  private async gql(query: string, variables: Record<string, unknown> = {}): Promise<unknown> {
    const resposta = await this.buscar(API, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: this.chave },
      body: JSON.stringify({ query, variables }),
    });

    let json: unknown;
    try {
      json = await resposta.json();
    } catch {
      throw new Error(`Linear: resposta não é JSON (HTTP ${resposta.status}).`);
    }

    const erros = campo(json, "errors");
    if (erros !== undefined && erros !== null) throw new Error(`Linear: ${JSON.stringify(erros)}`);
    return campo(json, "data");
  }

  async criarIssue(e: { titulo: string; descricao: string }): Promise<{ id: string; url: string }> {
    const dados = await this.gql(
      "mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { id url } } }",
      {
        input: {
          teamId: this.teamId,
          title: e.titulo,
          description: e.descricao,
          labelIds: [this.labelId],
        },
      },
    );
    return {
      id: exigirTexto(dados, "issueCreate.issue.id"),
      url: exigirTexto(dados, "issueCreate.issue.url"),
    };
  }

  async comentar(issueId: string, corpo: string): Promise<void> {
    await this.gql(
      "mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }",
      { input: { issueId, body: corpo } },
    );
  }

  /** Três passos: pede URL assinada, sobe os bytes, anexa o asset na issue. */
  async anexar(issueId: string, bytes: Buffer, nome: string, mediaTipo: string): Promise<{ url: string }> {
    const dados = await this.gql(
      `mutation($contentType: String!, $filename: String!, $size: Int!) {
        fileUpload(contentType: $contentType, filename: $filename, size: $size) {
          success uploadFile { uploadUrl assetUrl headers { key value } }
        }
      }`,
      { contentType: mediaTipo, filename: nome, size: bytes.byteLength },
    );

    const upload = caminho(dados, "fileUpload.uploadFile");
    const uploadUrl = exigirTexto(upload, "uploadUrl");
    const assetUrl = exigirTexto(upload, "assetUrl");

    const cabecalhos: Record<string, string> = { "content-type": mediaTipo };
    const extras = campo(upload, "headers");
    if (Array.isArray(extras))
      for (const h of extras) {
        const chave = campo(h, "key");
        const valor = campo(h, "value");
        if (typeof chave === "string" && typeof valor === "string") cabecalhos[chave] = valor;
      }

    const envio = await this.buscar(uploadUrl, {
      method: "PUT",
      headers: cabecalhos,
      body: new Uint8Array(bytes),
    });
    if (!envio.ok) throw new Error(`Linear: upload de ${nome} falhou com HTTP ${envio.status}.`);

    await this.gql(
      "mutation($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }",
      { input: { issueId, title: nome, url: assetUrl } },
    );
    return { url: assetUrl };
  }

  async moverEstado(issueId: string, estado: string): Promise<void> {
    const dados = await this.gql(
      "query($teamId: String!) { team(id: $teamId) { states { nodes { id name } } } }",
      { teamId: this.teamId },
    );

    const nos = caminho(dados, "team.states.nodes");
    if (!Array.isArray(nos)) throw new Error("Linear: resposta sem team.states.nodes.");
    const alvo = nos.find((n) => {
      const nome = campo(n, "name");
      return typeof nome === "string" && nome.toLowerCase() === estado.toLowerCase();
    });
    if (!alvo) throw new Error(`Linear: o time não tem o estado "${estado}".`);

    await this.gql(
      "mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }",
      { id: issueId, input: { stateId: exigirTexto(alvo, "id") } },
    );
  }
}
