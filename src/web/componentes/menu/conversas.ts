import type { MudancaConversa } from "../../../agent/conversas";
import type { Conversa } from "../../tipos";
import type { PilhaDeDesfazer } from "./desfazer";

/** O que a lista precisa do servidor. Injetado para os testes rodarem sem rede. */
export interface ApiConversas {
  listar(arquivadas: boolean): Promise<Conversa[]>;
  mudar(id: string, mudanca: MudancaConversa): Promise<Conversa>;
  apagar(id: string): Promise<void>;
  restaurar(id: string): Promise<Conversa>;
}

export interface Lista {
  ativas: readonly Conversa[];
  arquivadas: readonly Conversa[];
  pronta: boolean;
}

/** O toast: com `chave`, oferece Desfazer, que consome a mesma entrada da pilha que o ⌘Z. */
export type Aviso = { tipo: "desfazivel"; chave: number; texto: string; nome?: string } | { tipo: "erro"; texto: string };

/** atualizadaEm é texto ISO-like do SQLite; a ordem lexical é a ordem do tempo. */
const maisNovaPrimeiro = (a: Conversa, b: Conversa) => b.atualizadaEm.localeCompare(a.atualizadaEm);

const sem = (lista: readonly Conversa[], id: string) => lista.filter((c) => c.id !== id);
const com = (lista: readonly Conversa[], c: Conversa) => [...sem(lista, c.id), c].sort(maisNovaPrimeiro);

/**
 * A lista de conversas da barra, com mudanças otimistas: a tela muda na hora, o servidor
 * confirma depois, e uma falha desfaz a mudança e avisa. Excluir e arquivar empilham um
 * desfazer na pilha do app, que o toast e o ⌘Z consomem.
 */
export function criarConversas(api: ApiConversas, avisar: (a: Aviso) => void, pilha: PilhaDeDesfazer) {
  let estado: Lista = { ativas: [], arquivadas: [], pronta: false };
  const ouvintes = new Set<() => void>();
  /** Excluídas esperando o servidor: uma releitura no meio não pode trazê-las de volta. */
  const apagando = new Set<string>();

  const mudar = (novo: Partial<Lista>) => {
    estado = { ...estado, ...novo };
    for (const o of ouvintes) o();
  };
  const achar = (id: string) => estado.ativas.find((c) => c.id === id) ?? estado.arquivadas.find((c) => c.id === id);
  const recolocar = (c: Conversa) =>
    c.arquivadaEm === null ? mudar({ ativas: com(estado.ativas, c), arquivadas: sem(estado.arquivadas, c.id) }) : mudar({ arquivadas: com(estado.arquivadas, c), ativas: sem(estado.ativas, c.id) });
  const tirar = (id: string) => mudar({ ativas: sem(estado.ativas, id), arquivadas: sem(estado.arquivadas, id) });
  const falhou = (texto: string) => avisar({ tipo: "erro", texto });

  async function arquivar(id: string, paraArquivar: boolean, comDesfazer = true): Promise<void> {
    const antes = achar(id);
    if (!antes || (antes.arquivadaEm !== null) === paraArquivar) return;
    recolocar({ ...antes, arquivadaEm: paraArquivar ? Date.now() : null });
    const pedido = api.mudar(id, { arquivada: paraArquivar });
    const d = comDesfazer
      ? pilha.empilhar(async () => {
          await pedido.catch(() => {});
          await arquivar(id, !paraArquivar, false);
        })
      : null;
    try {
      recolocar(await pedido);
      if (d !== null && pilha.contem(d)) avisar({ tipo: "desfazivel", chave: d, texto: paraArquivar ? "Conversa arquivada:" : "Conversa desarquivada:", nome: antes.titulo });
    } catch {
      if (d !== null) pilha.descartar(d);
      recolocar(antes);
      falhou(paraArquivar ? "Não deu para arquivar a conversa." : "Não deu para desarquivar a conversa.");
    }
  }

  return {
    assinar(o: () => void) {
      ouvintes.add(o);
      return () => void ouvintes.delete(o);
    },
    ler: () => estado,
    achar,

    async carregar() {
      try {
        const [ativas, arquivadas] = await Promise.all([api.listar(false), api.listar(true)]);
        const vivas = (l: Conversa[]) => l.filter((c) => !apagando.has(c.id));
        mudar({ ativas: vivas(ativas), arquivadas: vivas(arquivadas), pronta: true });
      } catch {
        if (!estado.pronta) mudar({ pronta: true });
      }
    },

    async renomear(id: string, titulo: string) {
      const antes = achar(id);
      const novo = titulo.trim();
      if (!antes || !novo || novo === antes.titulo) return;
      recolocar({ ...antes, titulo: novo });
      try {
        recolocar(await api.mudar(id, { titulo: novo }));
      } catch {
        if (achar(id)?.titulo === novo) recolocar({ ...achar(id)!, titulo: antes.titulo });
        falhou("Não deu para renomear a conversa.");
      }
    },

    arquivar,

    async excluir(id: string, aoDesfazer?: () => void) {
      const antes = achar(id);
      if (!antes) return;
      apagando.add(id);
      tirar(id);
      const pedido = api.apagar(id);
      const d = pilha.empilhar(async () => {
        recolocar(antes);
        try {
          await pedido;
          recolocar(await api.restaurar(id));
          aoDesfazer?.();
        } catch {
          tirar(id);
          falhou("Não deu para restaurar a conversa.");
        }
      });
      try {
        await pedido;
        // Um ⌘Z antes da resposta já desfez: o toast não tem mais o que oferecer.
        if (pilha.contem(d)) avisar({ tipo: "desfazivel", chave: d, texto: "Conversa excluída:", nome: antes.titulo });
      } catch {
        pilha.descartar(d);
        recolocar(antes);
        falhou("Não deu para excluir a conversa.");
      } finally {
        apagando.delete(id);
      }
    },
  };
}

export type Conversas = ReturnType<typeof criarConversas>;
