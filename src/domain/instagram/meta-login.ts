import { existsSync, readFileSync, writeFileSync } from "node:fs";

const GRAPH = "https://graph.facebook.com/v23.0";
/** Lido a cada chamada: o teste aponta para um arquivo temporário depois que o módulo já carregou. */
const arquivo = () => process.env.IG_CREDENCIAIS_ARQUIVO ?? "data/instagram.json";

export interface Credenciais {
  igUserId: string;
  pageToken: string;
  pagina: string;
}

/** O .env manda; o arquivo é o que o login da Meta grava. */
export function credenciais(): Credenciais {
  const doArquivo: Partial<Credenciais> = existsSync(arquivo()) ? JSON.parse(readFileSync(arquivo(), "utf8")) : {};
  const igUserId = process.env.IG_USER_ID ?? doArquivo.igUserId;
  const pageToken = process.env.IG_PAGE_TOKEN ?? doArquivo.pageToken;
  if (!igUserId || !pageToken) throw new Error("Instagram não conectado. Abra /auth/meta e faça login.");
  return { igUserId, pageToken, pagina: doArquivo.pagina ?? "" };
}

function config() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const configId = process.env.META_CONFIG_ID;
  if (!appId || !appSecret || !configId) throw new Error("Faltam META_APP_ID, META_APP_SECRET ou META_CONFIG_ID no .env.");
  return { appId, appSecret, configId };
}

export const redirectUri = (origem: string) => `${process.env.PUBLIC_BASE_URL ?? origem}/auth/meta/callback`;

export function urlDeLogin(origem: string, state: string): string {
  const { appId, configId } = config();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri(origem),
    config_id: configId,
    response_type: "code",
    override_default_response_type: "true",
    state,
  });
  return `https://www.facebook.com/v23.0/dialog/oauth?${params}`;
}

async function pegar(caminho: string, params: Record<string, string>): Promise<any> {
  const res = await fetch(`${GRAPH}/${caminho}?${new URLSearchParams(params)}`);
  const json: any = await res.json();
  if (json.error) throw new Error(`Meta ${caminho}: ${json.error.message}`);
  return json;
}

/**
 * Código do login → token de usuário de longa duração → Page token.
 * O Page token tirado de um token de longa duração não expira.
 */
export async function concluirLogin(codigo: string, origem: string): Promise<Credenciais> {
  const { appId, appSecret } = config();
  const curto = await pegar("oauth/access_token", {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri(origem),
    code: codigo,
  });
  const longo = await pegar("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: curto.access_token,
  });
  const { data } = await pegar("me/accounts", {
    fields: "name,access_token,instagram_business_account",
    access_token: longo.access_token,
  });
  const comInstagram = (data as any[]).filter((p) => p.instagram_business_account?.id);
  if (comInstagram.length === 0) {
    throw new Error("Nenhuma página com Instagram profissional ligado. Ligue a @emvidros à página do Facebook e tente de novo.");
  }
  const pagina = comInstagram.find((p) => /emvidros/i.test(p.name)) ?? comInstagram[0];
  const salvas: Credenciais = {
    igUserId: pagina.instagram_business_account.id,
    pageToken: pagina.access_token,
    pagina: pagina.name,
  };
  writeFileSync(arquivo(), JSON.stringify(salvas, null, 2), { mode: 0o600 });
  return salvas;
}
