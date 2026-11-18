import type { Dia } from "../../../agent/calendario";

/**
 * Datas do calendário, sempre no dia de São Paulo. O Brasil não tem horário de verão desde
 * 2019, então o fuso é UTC-3 fixo e a conta de dias pode ser feita em UTC sobre o texto
 * AAAA-MM-DD, sem depender do fuso de quem abre a tela.
 */

export type { Dia };

const DIA_MS = 86_400_000;
const FUSO_MS = 3 * 3_600_000;

const utc = (dia: Dia) => Date.parse(`${dia}T00:00:00Z`);
const deUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10) as Dia;

export const inicioDoDia = (dia: Dia) => utc(dia) + FUSO_MS;
export const diaDe = (ms: number): Dia => deUtc(ms - FUSO_MS);
export const hoje = (agora = Date.now()) => diaDe(agora);
/** Minutos desde a meia-noite de São Paulo. */
export const minutosDe = (ms: number) => Math.floor(((ms - FUSO_MS) % DIA_MS + DIA_MS) % DIA_MS / 60_000);
export const epochDe = (dia: Dia, minutos: number) => inicioDoDia(dia) + minutos * 60_000;

export const somarDias = (dia: Dia, n: number): Dia => deUtc(utc(dia) + n * DIA_MS);
export const diasEntre = (de: Dia, ate: Dia) => Math.round((utc(ate) - utc(de)) / DIA_MS);

export const textoDaHora = (minutos: number) => `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;

export function minutosDaHora(hora: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hora);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

// --- texto ---

const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { ...o, timeZone: "UTC" });
const MES = fmt({ month: "long" });
const SEMANA = fmt({ weekday: "long" });
const meioDia = (dia: Dia) => utc(dia) + DIA_MS / 2;

export const ano = (dia: Dia) => dia.slice(0, 4);
export const numeroDoDia = (dia: Dia) => Number(dia.slice(8));
/** "outubro" */
export const nomeDoMes = (dia: Dia) => MES.format(meioDia(dia));
/** "quinta" */
export const nomeDaSemana = (dia: Dia) => SEMANA.format(meioDia(dia)).replace("-feira", "");
/** "quinta, 16 de outubro", com o ano só fora do ano de hoje. */
export function diaPorExtenso(dia: Dia, agora = Date.now()): string {
  const texto = `${nomeDaSemana(dia)}, ${numeroDoDia(dia)} de ${nomeDoMes(dia)}`;
  return ano(dia) === ano(hoje(agora)) ? texto : `${texto} de ${ano(dia)}`;
}
/** "quinta, 16 de outubro, 18:00" */
export const momentoPorExtenso = (ms: number, agora = Date.now()) => `${diaPorExtenso(diaDe(ms), agora)}, ${textoDaHora(minutosDe(ms))}`;
