const FUSO = "America/Sao_Paulo";
// Brasil não tem horário de verão desde 2019: o offset de São Paulo é fixo.
const OFFSET = "-03:00";
const DIA_MS = 86_400_000;

const semana = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, weekday: "long" });
const data = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, day: "2-digit", month: "2-digit", year: "numeric" });
const iso = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" });
const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** O dia em São Paulo, "AAAA-MM-DD". */
export const diaDe = (ms: number) => iso.format(ms);

const linhaDoDia = (ms: number) => `${semana.format(ms)} ${data.format(ms)} (${iso.format(ms)})`;

/**
 * A data de hoje e as duas semanas seguintes, para o modelo resolver "nessa sexta", "amanhã" ou
 * "semana que vem" sem perguntar dia nem ano. O modelo não sabe que dia é hoje; sem isto ele pergunta.
 */
export function contextoDeData(agora: number = Date.now()): string {
  const proximos = Array.from({ length: 14 }, (_, i) => `- ${linhaDoDia(agora + (i + 1) * DIA_MS)}`);
  return [
    "--- DATA DE HOJE ---",
    `Agora é ${linhaDoDia(agora)}, ${hora.format(agora)} no horário de Brasília (offset ${OFFSET}).`,
    "Próximos 14 dias:",
    ...proximos,
    "Resolva sozinho qualquer data relativa com esta lista e não pergunte dia nem ano. \"Nessa sexta\", \"sexta agora\" ou \"sexta\" é a primeira sexta a partir de hoje; se hoje for sexta, é hoje. \"Semana que vem\" é a semana seguinte a esta. Sem ano, é a próxima ocorrência da data. Diga a data por extenso na resposta para o usuário conferir.",
  ].join("\n");
}
