import type { Formato, Pilar, StatusPost, TipoMidia } from "../../db";

export const PILARES: readonly Pilar[] = ["PROVA", "AUTORIDADE", "GENTE", "MARCA"];

/** Rótulo e cor de cada status de peça. A cor nunca vem sozinha: o rótulo sempre aparece junto. */
export const STATUS_POST: Record<StatusPost, { rotulo: string; cor: string }> = {
  draft: { rotulo: "Rascunho", cor: "text-tinta-3" },
  generated: { rotulo: "Artes geradas", cor: "text-tinta-2" },
  chosen: { rotulo: "Arte escolhida", cor: "text-tinta-2" },
  scheduled: { rotulo: "Agendado", cor: "text-[hsl(45_100%_29%)]" },
  published: { rotulo: "Publicado", cor: "text-tinta-2" },
  failed: { rotulo: "Falhou", cor: "text-erro" },
  archived: { rotulo: "Arquivado", cor: "text-tinta-3" },
};

export const FORMATO: Record<Formato, string> = { feed: "Feed", stories: "Stories", ambos: "Feed e stories" };

export const MIDIA: Record<TipoMidia, string> = { IMAGE: "Feed", STORIES: "Stories" };

const FUSO = "America/Sao_Paulo";

const comDia = (weekday: "long" | "short") =>
  new Intl.DateTimeFormat("pt-BR", { weekday, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: FUSO });

/** Sem os pontos, o "de" e o "-feira" que o Intl põe e só pesam na linha. */
function semPeso(formato: Intl.DateTimeFormat) {
  return {
    format(d: Date | number) {
      const p = Object.fromEntries(formato.formatToParts(d).map((x) => [x.type, x.value]));
      return `${p.weekday!.replace("-feira", "").replace(".", "")}, ${p.day} ${p.month!.replace(".", "")}, ${p.hour}:${p.minute}`;
    },
  };
}

/** "quinta, 16 out, 18:00" no horário de São Paulo, como no canvas. */
export const dataEHora = semPeso(comDia("long"));

/** "qui, 16 out, 18:00", para as linhas com pouco espaço. */
export const dataCurta = semPeso(comDia("short"));

export const hora = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: FUSO });

const diaEMes = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", timeZone: FUSO });

/** "10 out" */
export const dia = {
  format: (d: Date | number) => diaEMes.format(d).replace(" de ", " ").replace(".", ""),
};
