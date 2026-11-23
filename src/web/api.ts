import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversaExcluida } from "../agent/conversas";
import type { ConversaDaPauta, Dia, ItemAgendado, ItemCalendario, ItemPauta, NovaPauta } from "../agent/calendario";
import type { DataDaEquipe, NovaData } from "../domain/scheduler/calendar";
import type { PedidoDeAgendamento, Pronto, Reagendado } from "../agent/fila";
import type { EstadoDaChave, Provedor } from "../domain/chaves";
import type { Movimento } from "../domain/saldo";
import type { Edicao } from "../v2/artes";
import type { Formato } from "../v2/camadas";
import type { PedidoDeArte } from "../v2/campos";
import type { Arte, PecaPronta, Referencia } from "../v2/schema";
import type { ApiConversas } from "./componentes/menu/conversas";
import { navegar } from "./rota";
import type { Conversa } from "./tipos";

export class ErroDeApi extends Error {
  constructor(
    readonly status: number,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

async function pedir(caminho: string, init: RequestInit): Promise<Response> {
  const res = await fetch(caminho, {
    ...init,
    headers: { accept: "application/json", ...(typeof init.body === "string" ? { "content-type": "application/json" } : {}), ...(init.headers as Record<string, string> | undefined) },
  });
  if (res.status === 401) navegar("/entrar", { substituir: true });
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroDeApi(res.status, corpo?.erro ?? `Erro ${res.status}`);
  }
  return res;
}

/** GET numa rota do nosso servidor. 401 manda para /entrar; os tipos vêm do servidor, então não reparseia. */
export async function pegar<T>(caminho: string, sinal?: AbortSignal): Promise<T> {
  return (await pedir(caminho, { signal: sinal })).json() as Promise<T>;
}

/** As rotas de gestão de conversa (PATCH, DELETE, restaurar). */
export const apiConversas: ApiConversas = {
  listar: (arquivadas) => pegar<Conversa[]>(arquivadas ? "/api/conversas?arquivadas=1" : "/api/conversas"),
  mudar: async (id, mudanca) =>
    (await pedir(`/api/conversas/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(mudanca) })).json() as Promise<Conversa>,
  apagar: async (id) => (await pedir(`/api/conversas/${encodeURIComponent(id)}`, { method: "DELETE" })).json() as Promise<ConversaExcluida>,
  restaurar: async (excluida) =>
    (await pedir(`/api/conversas/${encodeURIComponent(excluida.conversa.id)}/restaurar`, { method: "POST", body: JSON.stringify(excluida) })).json() as Promise<Conversa>,
};

const comCorpo = async <T>(caminho: string, method: string, corpo?: unknown): Promise<T> =>
  (await pedir(caminho, { method, body: corpo === undefined ? undefined : JSON.stringify(corpo) })).json() as Promise<T>;
const semCorpo = async (caminho: string, method: string) => void (await pedir(caminho, { method }));

/** Para o turno do bot no servidor; o useChat só corta o que chega na tela. */
export const pararResposta = (conversaId: string) => semCorpo(`/api/conversas/${encodeURIComponent(conversaId)}/parar`, "POST");

/** As rotas do calendário (.specs/project/CALENDARIO.md, "API"). Horários em epoch ms. */
export const apiCalendario = {
  itens: (de: Dia, ate: Dia, sinal?: AbortSignal) => pegar<ItemCalendario[]>(`/api/calendario?de=${de}&ate=${ate}`, sinal),
  criarPauta: (p: Partial<NovaPauta> & Pick<NovaPauta, "dia" | "titulo">) => comCorpo<ItemPauta>("/api/pautas", "POST", p),
  mudarPauta: (id: number, mudanca: Partial<NovaPauta>) => comCorpo<ItemPauta>(`/api/pautas/${id}`, "PATCH", mudanca),
  apagarPauta: (id: number) => semCorpo(`/api/pautas/${id}`, "DELETE"),
  restaurarPauta: (id: number) => comCorpo<ItemPauta>(`/api/pautas/${id}/restaurar`, "POST"),
  conversaDaPauta: (id: number) => comCorpo<ConversaDaPauta>(`/api/pautas/${id}/conversa`, "POST"),
  criarData: (d: Pick<NovaData, "mmdd" | "ano" | "nome"> & Partial<NovaData>) => comCorpo<DataDaEquipe>("/api/datas", "POST", d),
  mudarData: (id: number, mudanca: Partial<Omit<NovaData, "mmdd">>) => comCorpo<DataDaEquipe>(`/api/datas/${id}`, "PATCH", mudanca),
  apagarData: (id: number) => semCorpo(`/api/datas/${id}`, "DELETE"),
  restaurarData: (id: number) => comCorpo<DataDaEquipe>(`/api/datas/${id}/restaurar`, "POST"),
  prontos: () => pegar<Pronto[]>("/api/prontos"),
  agendar: (pedido: PedidoDeAgendamento) => comCorpo<ItemAgendado>("/api/fila", "POST", pedido),
  reagendar: (filaId: number, publicaEm: number) => comCorpo<Reagendado>(`/api/fila/${filaId}`, "PATCH", { publicaEm }),
  cancelar: (filaId: number) => semCorpo(`/api/fila/${filaId}`, "DELETE"),
  restaurarAgendado: (filaId: number) => comCorpo<ItemAgendado>(`/api/fila/${filaId}/restaurar`, "POST"),
};

export type ApiCalendario = typeof apiCalendario;

/** As chaves de IA que a equipe conecta (src/domain/chaves.ts). A resposta nunca traz a chave. */
export const apiChaves = {
  listar: () => pegar<EstadoDaChave[]>("/api/chaves"),
  conectar: (p: Provedor, chave: string) => comCorpo<EstadoDaChave>(`/api/chaves/${p}`, "PUT", { chave }),
  desconectar: (p: Provedor) => comCorpo<EstadoDaChave>(`/api/chaves/${p}`, "DELETE"),
};

/** Uma arte como chega pela API: as datas vêm em texto ISO. */
/** `separavel` só vem no GET: a arte nasceu de uma imagem com texto desenhado e ainda não foi separada em camadas. */
export type ArteDaApi = Omit<Arte, "criadaEm" | "atualizadaEm"> & { criadaEm: string; atualizadaEm: string; separavel?: boolean };

/** As rotas de artes do backend novo (src/v2/api.ts). */
/** Um convite ou uma arte de aniversário: os campos como a pessoa escreveu, mais o formato. */
export type NovaArteComCampos = { tipo: PedidoDeArte["tipo"]; formato: Formato; campos: Record<string, string | undefined> };

export const apiArtes = {
  /** Cria a arte com os campos de um tipo. Leva uns 30 segundos: o modelo de imagem gera a cena. */
  criar: (pedido: NovaArteComCampos) => comCorpo<ArteDaApi>("/api/artes", "POST", pedido),
  /** Devolve a arte inteira; `restaurar` aceita esse mesmo corpo de volta. */
  apagar: (id: string) => comCorpo<ArteDaApi>(`/api/artes/${id}`, "DELETE"),
  restaurar: (arte: ArteDaApi) => comCorpo<ArteDaApi>(`/api/artes/${arte.id}/restaurar`, "POST", arte),
  /** `base` é o atualizadaEm da versão editada; se outra pessoa gravou depois, o servidor recusa com 409. */
  gravar: async (id: string, edicao: Edicao, base: string) =>
    (await pedir(`/api/artes/${id}`, { method: "PUT", body: JSON.stringify(edicao), headers: { "if-match": base } })).json() as Promise<ArteDaApi>,
  novaCena: (id: string) => comCorpo<ArteDaApi>(`/api/artes/${id}/cena`, "POST"),
  /** Tira texto e logo de dentro da imagem e devolve a arte com eles em camadas. Leva perto de um minuto. */
  separar: (id: string) => comCorpo<ArteDaApi>(`/api/artes/${id}/separar`, "POST"),
  /** Imagem ou SVG para uma camada. O servidor devolve o PNG guardado e a proporção dele. */
  enviarImagem: async (id: string, arquivo: File) => {
    const form = new FormData();
    form.set("arquivo", arquivo);
    return (await pedir(`/api/artes/${id}/imagens`, { method: "POST", body: form })).json() as Promise<{ chave: string; proporcao: number }>;
  },
  /** O PNG final. A versão na query troca a URL a cada gravação, para o navegador não mostrar o render velho. */
  png: (arte: ArteDaApi) => `/api/artes/${arte.id}/png?v=${Date.parse(arte.atualizadaEm)}`,
};

export type ReferenciaDaApi = Omit<Referencia, "criadaEm" | "removidaEm"> & { criadaEm: string; removidaEm: string | null };

/** As imagens de inspiração da Biblioteca (src/v2/api.ts). Enviar espera a IA ler a imagem, uns segundos. */
/** O saldo informado da OpenAI (domain/saldo.ts). */
export const apiSaldo = {
  informar: (tipo: "saldo" | "deposito", valor: number) => comCorpo<Movimento>("/api/saldo", "POST", { tipo, valor }),
  remover: (id: string) => semCorpo(`/api/saldo/${id}`, "DELETE"),
  restaurar: (id: string) => semCorpo(`/api/saldo/${id}/restaurar`, "POST"),
};

export const apiReferencias = {
  enviar: async (arquivo: File) => {
    const form = new FormData();
    form.set("arquivo", arquivo);
    return (await pedir("/api/referencias", { method: "POST", body: form })).json() as Promise<ReferenciaDaApi>;
  },
  remover: (id: string) => semCorpo(`/api/referencias/${id}`, "DELETE"),
  restaurar: (id: string) => comCorpo<ReferenciaDaApi>(`/api/referencias/${id}/restaurar`, "POST"),
  imagem: (r: ReferenciaDaApi) => `/api/arquivos/${r.arquivo}`,
};

export type PecaProntaDaApi = Omit<PecaPronta, "criadaEm" | "removidaEm"> & { criadaEm: string; removidaEm: string | null; url: string };

/** As peças prontas da Biblioteca (src/v2/api.ts). Enviar espera a IA ler a peça, uns segundos. */
export const apiPecasProntas = {
  enviar: async (arquivo: File) => {
    const form = new FormData();
    form.set("arquivo", arquivo);
    return (await pedir("/api/pecas-prontas", { method: "POST", body: form })).json() as Promise<PecaProntaDaApi>;
  },
  remover: (id: string) => semCorpo(`/api/pecas-prontas/${id}`, "DELETE"),
  restaurar: (id: string) => comCorpo<PecaProntaDaApi>(`/api/pecas-prontas/${id}/restaurar`, "POST"),
  legenda: (id: string, legenda: string) => comCorpo<PecaProntaDaApi>(`/api/pecas-prontas/${id}`, "PATCH", { legenda }),
  /** Uma conversa nova com o Chefe e o pedido que a tela manda nela. */
  conversa: (id: string) => comCorpo<{ conversaId: string; pedido: string }>(`/api/pecas-prontas/${id}/conversa`, "POST"),
};

/** A imagem do pedido: sobe sem a IA ler, e guardar na Biblioteca reusa o mesmo arquivo. */
export const apiImagensDoPedido = {
  subir: async (arquivo: File) => {
    const form = new FormData();
    form.set("arquivo", arquivo);
    return (await pedir("/api/arquivos", { method: "POST", body: form })).json() as Promise<{ chave: string }>;
  },
  /** `criada` diz se este clique pôs a imagem na Biblioteca; só ele oferece Desfazer. */
  guardar: (chave: string) => comCorpo<ReferenciaDaApi & { criada: boolean }>(`/api/arquivos/${chave}/referencia`, "POST"),
  url: (chave: string) => `/api/arquivos/${chave}`,
};

export type Carga<T> = { estado: "carregando" } | { estado: "pronto"; dados: T } | { estado: "erro"; erro: ErroDeApi | Error };

/**
 * Lê uma rota e, com `intervalo`, relê enquanto a aba está visível. `recarregar` relê na hora.
 * Uma releitura que falha mantém os últimos dados na tela.
 */
export function useApi<T>(caminho: string | null, intervalo?: number) {
  const [carga, setCarga] = useState<Carga<T>>({ estado: "carregando" });
  const [versao, setVersao] = useState(0);
  const recarregar = useCallback(() => setVersao((v) => v + 1), []);
  const caminhoLido = useRef(caminho);

  useEffect(() => {
    if (!caminho) return;
    // Tentar de novo depois de um erro mostra o carregando outra vez. Outro caminho também: os dados do anterior não valem para ele.
    const outro = caminhoLido.current !== caminho;
    caminhoLido.current = caminho;
    setCarga((c) => (outro || c.estado === "erro" ? { estado: "carregando" } : c));
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const buscar = () =>
      pegar<T>(caminho, ctl.signal)
        .then((dados) => setCarga({ estado: "pronto", dados }))
        .catch((erro: Error) => {
          if (erro.name !== "AbortError") setCarga((c) => (c.estado === "pronto" ? c : { estado: "erro", erro }));
        })
        .finally(agendar);
    const agendar = () => {
      if (intervalo && !ctl.signal.aborted) timer = setTimeout(() => (document.hidden ? agendar() : buscar()), intervalo);
    };
    buscar();
    return () => {
      ctl.abort();
      clearTimeout(timer);
    };
  }, [caminho, intervalo, versao]);

  return [carga, recarregar] as const;
}
