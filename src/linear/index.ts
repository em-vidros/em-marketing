const API = "https://api.linear.app/graphql";
const TEAM_ID = "ec0c88f8-96c2-40b2-853c-98f62b4d98fa"; // time EM Vidros (já existe)
const PROJECT_EM_MARKETING = "184d5269-422c-4d82-9a69-f32d971447b9"; // projeto EM Marketing (fora dos ciclos)
const LABEL_INSTAGRAM_POST = process.env.LINEAR_LABEL_ID; // uuid da label "Instagram Post"

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: process.env.LINEAR_API_KEY!,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json: any = await res.json();
  if (json.errors) throw new Error(`Linear: ${JSON.stringify(json.errors)}`);
  return json.data;
}

export async function createIssue(opts: { title: string; description: string }): Promise<{ id: string; url: string }> {
  if (!LABEL_INSTAGRAM_POST) throw new Error("LINEAR_LABEL_ID não configurado");
  const data = await gql(
    `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { issue { id url } } }`,
    {
      input: {
        teamId: TEAM_ID,
        projectId: PROJECT_EM_MARKETING,
        title: opts.title,
        description: opts.description,
        labelIds: [LABEL_INSTAGRAM_POST],
      },
    },
  );
  return data.issueCreate.issue;
}

export async function commentOnIssue(issueId: string, body: string) {
  await gql(`mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }`, {
    input: { issueId, body },
  });
}

/** Upload de anexo: pede URL assinada, sobe o JPEG, anexa na issue. */
export async function attachJpeg(issueId: string, path: string, filename: string) {
  const file = Bun.file(path);
  const size = file.size;
  const data = await gql(
    `mutation($contentType: String!, $filename: String!, $size: Int!) {
      fileUpload(contentType: $contentType, filename: $filename, size: $size) {
        success uploadFile { uploadUrl assetUrl headers { key value } }
      }
    }`,
    { contentType: "image/jpeg", filename, size },
  );
  const up = data.fileUpload.uploadFile;
  const headers: Record<string, string> = { "content-type": "image/jpeg" };
  for (const h of up.headers ?? []) headers[h.key] = h.value;
  const putRes = await fetch(up.uploadUrl, { method: "PUT", headers, body: await file.arrayBuffer() });
  if (!putRes.ok) throw new Error(`Upload Linear falhou: ${putRes.status}`);
  await gql(
    `mutation($input: AttachmentCreateInput!) { attachmentCreate(input: $input) { success } }`,
    { input: { issueId, title: filename, url: up.assetUrl } },
  );
  return up.assetUrl as string;
}

export async function moveIssueState(issueId: string, stateName: string) {
  const data = await gql(
    `query($teamId: String!) { team(id: $teamId) { states { nodes { id name } } } }`,
    { teamId: TEAM_ID },
  );
  const state = data.team.states.nodes.find(
    (s: any) => s.name.toLowerCase() === stateName.toLowerCase(),
  );
  if (!state) {
    // Falhar calado aqui já custou caro: os estados foram renomeados para PT-BR
    // e a issue parou de sair de "Em andamento" sem nada no log.
    console.warn(`Linear: estado "${stateName}" não existe no time. Issue ${issueId} não foi movida.`);
    return;
  }
  await gql(`mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, {
    id: issueId,
    input: { stateId: state.id },
  });
}
