import { db } from "../db";
import { sendMessage } from "../telegram/api";

/**
 * US-7: calendário editorial — 3 dias antes de cada data recorrente,
 * manda um brief pronto para os chats da allowlist. Datas fixas de brand/calendario.md;
 * datas móveis (Páscoa, Dia das Mães) resolvidas por ano.
 */

interface Seed { mmdd: string; ocasiao: string; tipo: string }

const FIXED: Seed[] = [
  { mmdd: "03-08", ocasiao: "Dia das Mulheres", tipo: "data-comemorativa-regional" },
  { mmdd: "04-21", ocasiao: "Tiradentes", tipo: "data-comemorativa-regional" },
  { mmdd: "04-23", ocasiao: "Dia do Serralheiro", tipo: "dia-da-profissao" },
  { mmdd: "05-01", ocasiao: "Dia do Trabalho", tipo: "data-comemorativa-regional" },
  { mmdd: "05-18", ocasiao: "Dia do Vidraceiro", tipo: "dia-da-profissao" },
  { mmdd: "07-16", ocasiao: "Aniversário de Imperatriz", tipo: "data-comemorativa-regional" },
];

function easter(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function movable(year: number): Seed[] {
  const e = easter(year);
  const fmt = (d: Date) => d.toISOString().slice(5, 10);
  const goodFriday = new Date(e); goodFriday.setUTCDate(e.getUTCDate() - 2);
  // Dia das Mães: 2º domingo de maio
  const may1 = new Date(Date.UTC(year, 4, 1));
  const mothers = new Date(Date.UTC(year, 4, 1 + ((7 - may1.getUTCDay()) % 7) + 7));
  return [
    { mmdd: fmt(goodFriday), ocasiao: "Sexta-feira Santa / Páscoa", tipo: "data-comemorativa-regional" },
    { mmdd: fmt(mothers), ocasiao: "Dia das Mães", tipo: "data-comemorativa-regional" },
  ];
}

db.run(`CREATE TABLE IF NOT EXISTS calendar_sent (year INTEGER, mmdd TEXT, PRIMARY KEY (year, mmdd))`);

async function checkCalendar() {
  const now = new Date();
  const target = new Date(now.getTime() + 3 * 86400_000); // 3 dias antes
  const year = target.getFullYear();
  const mmdd = target.toISOString().slice(5, 10);
  const seeds = [...FIXED, ...movable(year)];
  const hit = seeds.find((s) => s.mmdd === mmdd);
  if (!hit) return;
  const seen = db.query("SELECT 1 FROM calendar_sent WHERE year = ? AND mmdd = ?").get(year, mmdd);
  if (seen) return;
  db.query("INSERT INTO calendar_sent (year, mmdd) VALUES (?, ?)").run(year, mmdd);

  const chats = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "").split(",").map(Number).filter(Boolean);
  for (const chatId of chats) {
    await sendMessage(
      chatId,
      `📅 Daqui a 3 dias: *${hit.ocasiao}*.\nQuer que eu prepare o post? Me responda algo como _"cria o post de ${hit.ocasiao}"_ — ou ignore esta mensagem.`,
      { parse_mode: "Markdown" },
    ).catch(() => {});
  }
}

export function startCalendar() {
  checkCalendar().catch(console.error);
  setInterval(() => checkCalendar().catch(console.error), 6 * 3600_000);
}
