import type { NovaPauta } from "../../../agent/calendario";
import type { PostPronto } from "../../../agent/fila";
import type { TipoMidia } from "../../../db";
import type { ApiCalendario } from "../../api";
import type { Aviso } from "../menu/conversas";
import type { PilhaDeDesfazer } from "../menu/desfazer";
import { diasEntre, momentoPorExtenso, diaPorExtenso, somarDias, textoDaHora, type Dia } from "./datas";
import { chaveDe, lugarDe, noLugar, ordem, tituloDe, type Chave, type ItemAgendado, type ItemCalendario, type ItemPauta, type Lugar, type Movel } from "./itens";

/** Blocos de 8 semanas a partir de um domingo: cabem no limite de 62 dias da rota e cobrem o mês da tela em um ou dois pedidos. */
const ORIGEM: Dia = "1970-01-04";
const BLOCO = 56;

const blocoDe = (dia: Dia) => Math.floor(diasEntre(ORIGEM, dia) / BLOCO);
const inicioDoBloco = (b: number) => somarDias(ORIGEM, b * BLOCO);

export interface Leitura {
  porDia: ReadonlyMap<Dia, readonly ItemCalendario[]>;
  achar: (chave: Chave) => ItemCalendario | null;
  /** Um bloco da tela falhou na primeira leitura e não tem nada para mostrar. */
  erro: Error | null;
  prontos: readonly PostPronto[] | null;
}

const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Os itens do calendário que a tela já leu, por bloco de dias, com mudanças otimistas por
 * cima: a tela muda na hora, o servidor confirma depois e uma falha volta atrás e avisa.
 * Cada mudança confirmada empilha o desfazer na pilha do app, que o toast e o ⌘Z consomem.
 */
export function criarAgenda(api: ApiCalendario, avisar: (a: Aviso) => void, pilha: PilhaDeDesfazer) {
  const base = new Map<Chave, ItemCalendario>();
  /** Mudanças esperando o servidor; null é um item que saiu. Uma releitura no meio não as desfaz. */
  const local = new Map<Chave, ItemCalendario | null>();
  const blocos = new Map<number, "carregando" | "pronto" | Error>();
  let prontos: PostPronto[] | null = null;
  const ouvintes = new Set<() => void>();
  let leitura: Leitura | null = null;

  const mudou = () => {
    leitura = null;
    for (const o of ouvintes) o();
  };

  function ler(): Leitura {
    if (leitura) return leitura;
    const todos = new Map(base);
    for (const [k, v] of local) v ? todos.set(k, v) : todos.delete(k);
    const porDia = new Map<Dia, ItemCalendario[]>();
    for (const i of todos.values()) {
      const { dia } = lugarDe(i);
      porDia.set(dia, [...(porDia.get(dia) ?? []), i]);
    }
    for (const lista of porDia.values()) lista.sort(ordem);
    const erro = [...blocos.values()].find((b): b is Error => b instanceof Error) ?? null;
    leitura = { porDia, achar: (k) => todos.get(k) ?? null, erro, prontos };
    return leitura;
  }

  async function lerBloco(b: number) {
    if (blocos.get(b) === "carregando") return;
    if (!blocos.has(b)) blocos.set(b, "carregando");
    const de = inicioDoBloco(b);
    const ate = somarDias(de, BLOCO - 1);
    try {
      const itens = await api.itens(de, ate);
      for (const [k, i] of base) {
        const { dia } = lugarDe(i);
        if (dia >= de && dia <= ate) base.delete(k);
      }
      for (const i of itens) base.set(chaveDe(i), i);
      blocos.set(b, "pronto");
    } catch (e) {
      // Uma releitura que falha mantém o que já estava na tela.
      if (blocos.get(b) !== "pronto") blocos.set(b, e instanceof Error ? e : new Error(mensagem(e)));
    }
    mudou();
  }

  async function lerProntos() {
    try {
      prontos = await api.prontos();
      mudou();
    } catch {}
  }

  function erroDe(texto: string, e: unknown) {
    avisar({ tipo: "erro", texto: `${texto} ${mensagem(e)}` });
  }

  /** Aplica `otimista` na hora; `pedir` confirma e devolve o item do servidor (null quando ele sai da tela). */
  async function aplicar<T>(chave: Chave, otimista: ItemCalendario | null, pedir: () => Promise<T>, doServidor: (r: T) => ItemCalendario | null) {
    local.set(chave, otimista);
    mudou();
    try {
      const r = await pedir();
      const item = doServidor(r);
      if (item) base.set(chaveDe(item), item);
      else base.delete(chave);
      if (local.get(chave) === otimista) local.delete(chave);
      mudou();
      return r;
    } catch (e) {
      if (local.get(chave) === otimista) local.delete(chave);
      mudou();
      throw e;
    }
  }

  function oferecerDesfazer(texto: string, nome: string | undefined, desfazer: () => Promise<unknown>) {
    const chave = pilha.empilhar(async () => {
      try {
        await desfazer();
      } catch (e) {
        erroDe("Não deu para desfazer.", e);
      }
    });
    avisar({ tipo: "desfazivel", chave, texto, nome });
  }

  const textoDoLugar = (l: Lugar) => (l.minutos === null ? diaPorExtenso(l.dia) : `${diaPorExtenso(l.dia)}, ${textoDaHora(l.minutos)}`);

  async function mudarPauta(p: ItemPauta, mudanca: Partial<NovaPauta>, desfazivel = true): Promise<ItemPauta | null> {
    const antes = Object.fromEntries(Object.keys(mudanca).map((k) => [k, p[k as keyof NovaPauta]])) as Partial<NovaPauta>;
    try {
      const nova = await aplicar(chaveDe(p), { ...p, ...mudanca }, () => api.mudarPauta(p.id, mudanca), (r) => r);
      if (desfazivel) {
        const moveu = mudanca.dia !== undefined || mudanca.hora !== undefined;
        const texto = moveu ? `Pauta movida para ${textoDoLugar(lugarDe(nova))}:` : "Pauta alterada:";
        oferecerDesfazer(texto, nova.titulo, () => mudarPauta(nova, antes, false));
      }
      return nova;
    } catch (e) {
      erroDe("Não deu para mudar a pauta.", e);
      return null;
    }
  }

  async function reagendar(a: ItemAgendado, publicaEm: number, desfazivel = true): Promise<boolean> {
    try {
      const r = await aplicar(chaveDe(a), { ...a, publicaEm }, () => api.reagendar(a.filaId, publicaEm), (r) => r.item);
      if (desfazivel) oferecerDesfazer(`Publicação movida para ${momentoPorExtenso(r.item.publicaEm)}:`, tituloDe(r.item), () => reagendar(r.item, r.anterior, false));
      return true;
    } catch (e) {
      erroDe("Não deu para mudar o horário da publicação.", e);
      return false;
    }
  }

  return {
    ler,
    assinar(o: () => void) {
      ouvintes.add(o);
      return () => void ouvintes.delete(o);
    },

    /** Lê os blocos que cobrem `de` a `ate` e ainda não foram lidos. */
    garantir(de: Dia, ate: Dia) {
      for (let b = blocoDe(de); b <= blocoDe(ate); b++) if (!blocos.has(b) || blocos.get(b) instanceof Error) void lerBloco(b);
      if (prontos === null) void lerProntos();
    },
    /** Relê tudo o que já foi lido, para trazer o que o Chefe ou outra pessoa mudou. */
    reler() {
      for (const b of blocos.keys()) void lerBloco(b);
      void lerProntos();
    },

    /** Uma prévia só na tela, sem servidor: o agendado arrastado esperando a confirmação. */
    prever(i: Movel, lugar: Lugar) {
      local.set(chaveDe(i), noLugar(i, lugar));
      mudou();
    },
    descartarPrevia(chave: Chave) {
      if (local.delete(chave)) mudou();
    },

    async criarPauta(nova: Pick<NovaPauta, "dia" | "titulo"> & Partial<NovaPauta>): Promise<ItemPauta | null> {
      try {
        const p = await api.criarPauta(nova);
        base.set(chaveDe(p), p);
        mudou();
        oferecerDesfazer("Pauta criada:", p.titulo, async () => {
          await aplicar(chaveDe(p), null, () => api.apagarPauta(p.id), () => null);
        });
        return p;
      } catch (e) {
        erroDe("Não deu para criar a pauta.", e);
        return null;
      }
    },

    mudarPauta,

    async apagarPauta(p: ItemPauta) {
      try {
        await aplicar(chaveDe(p), null, () => api.apagarPauta(p.id), () => null);
        oferecerDesfazer("Pauta apagada:", p.titulo, () => aplicar(chaveDe(p), p, () => api.restaurarPauta(p.id), (r) => r));
      } catch (e) {
        erroDe("Não deu para apagar a pauta.", e);
      }
    },

    /** Mudar o lugar de uma pauta ou de um agendado pendente. */
    mover(i: Movel, lugar: Lugar) {
      if (i.tipo === "pauta") {
        const destino = noLugar(i, lugar);
        return mudarPauta(i, { dia: destino.dia, hora: destino.hora });
      }
      return reagendar(i, noLugar(i, lugar).publicaEm);
    },

    async agendar(post: PostPronto, midia: TipoMidia, publicaEm: number): Promise<ItemAgendado | null> {
      try {
        const a = await api.agendar(post.postId, midia, publicaEm);
        base.set(chaveDe(a), a);
        mudou();
        void lerProntos();
        oferecerDesfazer(`Publicação agendada para ${momentoPorExtenso(a.publicaEm)}:`, tituloDe(a), async () => {
          await aplicar(chaveDe(a), null, () => api.cancelar(a.filaId), () => null);
          await lerProntos();
        });
        return a;
      } catch (e) {
        erroDe("Não deu para agendar.", e);
        return null;
      }
    },

    /** Cancela um pendente ou dispensa uma falha. Desfazer devolve o mesmo estado. */
    async cancelar(a: ItemAgendado) {
      const falha = a.status === "failed";
      try {
        await aplicar(chaveDe(a), null, () => api.cancelar(a.filaId), () => null);
        void lerProntos();
        oferecerDesfazer(falha ? "Falha dispensada:" : "Agendamento cancelado:", tituloDe(a), async () => {
          await aplicar(chaveDe(a), a, () => api.restaurarAgendado(a.filaId), (r) => r);
          await lerProntos();
        });
      } catch (e) {
        erroDe(falha ? "Não deu para dispensar a falha." : "Não deu para cancelar o agendamento.", e);
      }
    },

    conversaDaPauta: (p: ItemPauta) => api.conversaDaPauta(p.id),
  };
}

export type Agenda = ReturnType<typeof criarAgenda>;
