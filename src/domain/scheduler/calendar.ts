import { q } from "../../v2/banco";

/**
 * Calendário editorial: as datas recorrentes que podem virar post.
 *
 * O §12.4 decide quais datas o sistema propõe por conta própria: uma data só
 * entra aqui se passar em um de três testes, (a) é do setor, (b) é da região
 * onde há unidade, (c) é da empresa. Pedido explícito do usuário para outra
 * data não passa por esta lista: o post sai mesmo assim (agent/bots.ts, PEDIDO_MANDA).
 *
 * Todo seed declara em qual teste passa. Sem `teste`, o TypeScript não compila
 * e `validarSeeds` lança no boot.
 *
 * Além dos seeds, a equipe cadastra feriados e datas na tela do calendário
 * (tabela datas_comemorativas). Os dois somam no calendário e nos bots.
 */

export const TESTES = ["setor", "regiao", "empresa"] as const;
export type Teste = (typeof TESTES)[number];

/** Uma data do calendário. id null é um seed deste arquivo, só leitura; as outras a equipe cadastrou. */
export interface DataComemorativa {
  id: number | null;
  /** MM-DD */
  mmdd: string;
  /** null repete todo ano; com ano, a data vale só nele. */
  ano: number | null;
  nome: string;
  teste: Teste;
  porque: string;
}

/** A que a equipe cadastrou: sempre tem id e se edita. */
export type DataDaEquipe = DataComemorativa & { id: number };

export type NovaData = Omit<DataComemorativa, "id">;

interface Seed {
  mmdd: string;
  ocasiao: string;
  /** Qual dos três testes do §12.4 esta data passa. */
  teste: Teste;
  /** Por que passa — a justificativa fica no código, não na memória de quem escreveu. */
  porque: string;
  pilar: "MARCA";
}

const SEEDS: Seed[] = [
  // (a) do setor
  { mmdd: "04-23", ocasiao: "Dia do Serralheiro", teste: "setor", porque: "serralheiro é público primário (§1.2) e a data é nomeada no §12.4", pilar: "MARCA" },
  { mmdd: "05-01", ocasiao: "Início do Mês do Vidraceiro", teste: "setor", porque: "campanha do setor dirigida ao público primário", pilar: "MARCA" },
  { mmdd: "05-18", ocasiao: "Dia do Vidraceiro", teste: "setor", porque: "público primário nº 1; data nomeada no §12.4", pilar: "MARCA" },
  { mmdd: "12-15", ocasiao: "Dia do Arquiteto", teste: "setor", porque: "arquiteto e projetista são público primário (§1.2)", pilar: "MARCA" },

  // (b) da região onde há unidade
  { mmdd: "07-16", ocasiao: "Aniversário de Imperatriz", teste: "regiao", porque: "unidade e segunda fábrica em Imperatriz-MA", pilar: "MARCA" },
  { mmdd: "08-16", ocasiao: "Aniversário de Teresina", teste: "regiao", porque: "filial em Teresina-PI", pilar: "MARCA" },
  { mmdd: "09-08", ocasiao: "Aniversário de São Luís", teste: "regiao", porque: "duas filiais em São Luís-MA (Angelim e Guajajaras)", pilar: "MARCA" },

  // (c) da empresa
  { mmdd: "02-15", ocasiao: "Aniversário da EM Vidros", teste: "empresa", porque: "data de abertura do CNPJ 17.587.823 (matriz Raposa-MA)", pilar: "MARCA" },
];

/**
 * Removidas neste commit por reprovarem nos três testes do §12.4 — estavam em
 * brand/calendario.md e no FIXED[] anterior, gerando proativamente posts que a
 * própria norma proíbe:
 *   Dia das Mulheres · Tiradentes · Dia do Trabalho · Sexta-feira Santa / Páscoa
 *   · Janeiro Branco · Dia das Mães
 *
 * Dia das Mães é o caso desconfortável: a peça de Dia das Mães é o benchmark
 * estético do brandbook inteiro (§0.3), mas a data não é do setor, nem de
 * cidade com unidade, nem da empresa. A regra, como escrita, a exclui.
 * Decisão pendente do dono da marca — ver PENDENCIAS.md.
 *
 * Faltam confirmar as datas de aniversário de Raposa-MA, Santa Inês-MA,
 * Bacabal-MA e Ananindeua-PA, que têm unidade e portanto passam no teste (b).
 * Não foram semeadas porque a data não foi verificada — inventar seria pior.
 */

function validarSeeds(): void {
  const vistos = new Set<string>();
  for (const s of SEEDS) {
    if (!/^\d{2}-\d{2}$/.test(s.mmdd)) throw new Error(`Seed com mmdd inválido: ${s.ocasiao}`);
    if (!s.porque.trim()) throw new Error(`Seed sem justificativa do §12.4: ${s.ocasiao}`);
    if (vistos.has(s.mmdd)) throw new Error(`Duas datas em ${s.mmdd}`);
    vistos.add(s.mmdd);
  }
}
validarSeeds();

/**
 * Data em America/Sao_Paulo. O código anterior usava toISOString(), que é UTC —
 * entre 21h e 00h no horário de Brasília o calendário disparava no dia errado.
 */
const FMT_SP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function dataSP(d: Date): { year: number; mmdd: string } {
  const [ano, mes, dia] = FMT_SP.format(d).split("-");
  return { year: Number(ano), mmdd: `${mes}-${dia}` };
}

/** O dia existe: 04-31 nunca, 02-29 só em ano bissexto. Sem ano, 02-29 vale porque repete nos bissextos. */
export function diaExiste(mmdd: string, ano: number | null): boolean {
  const iso = `${ano ?? 2024}-${mmdd}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && new Date(`${iso}T00:00:00Z`).toISOString().startsWith(iso);
}

const FIXAS: readonly DataComemorativa[] = SEEDS.map((s) => ({ id: null, mmdd: s.mmdd, ano: null, nome: s.ocasiao, teste: s.teste, porque: s.porque }));

const caiEm = (d: DataComemorativa, ano: number, mmdd: string) => d.mmdd === mmdd && (d.ano === null || d.ano === ano);

/** Só a viva. A apagada some do calendário e dos bots até ser restaurada. */
export async function dataPorId(id: number): Promise<DataDaEquipe | null> {
  const [r] = await q<DataDaEquipe>`SELECT id, mmdd, ano, nome, teste, porque FROM datas_comemorativas WHERE id = ${id} AND apagada_em IS NULL`;
  return r ?? null;
}

async function todasAsDatas(): Promise<DataComemorativa[]> {
  return [...FIXAS, ...(await q<DataComemorativa>`SELECT id, mmdd, ano, nome, teste, porque FROM datas_comemorativas WHERE apagada_em IS NULL ORDER BY id`)];
}

export async function criarData(userId: string, d: NovaData): Promise<DataDaEquipe> {
  const agora = Date.now();
  const [r] = await q<{ id: number }>`INSERT INTO datas_comemorativas (mmdd, ano, nome, teste, porque, criada_por, criada_em, atualizada_em)
    VALUES (${d.mmdd}, ${d.ano}, ${d.nome}, ${d.teste}, ${d.porque}, ${userId}, ${agora}, ${agora}) RETURNING id`;
  return (await dataPorId(r!.id))!;
}

/** Só os campos mandados mudam. O dia fica: para trocar, apaga e cadastra de novo. */
export async function mudarData(id: number, mudanca: Partial<Omit<NovaData, "mmdd">>): Promise<DataDaEquipe | null> {
  const atual = await dataPorId(id);
  if (!atual) return null;
  const mandados = Object.fromEntries(Object.entries(mudanca).filter(([, v]) => v !== undefined));
  const d: DataDaEquipe = { ...atual, ...mandados };
  await q`UPDATE datas_comemorativas SET ano = ${d.ano}, nome = ${d.nome}, teste = ${d.teste}, porque = ${d.porque}, atualizada_em = ${Date.now()} WHERE id = ${id}`;
  return dataPorId(id);
}

/** Apagar de novo mantém a data da primeira vez. false se não existe. */
export async function apagarData(id: number): Promise<boolean> {
  return (await q`UPDATE datas_comemorativas SET apagada_em = COALESCE(apagada_em, ${Date.now()}::double precision) WHERE id = ${id} RETURNING id`).length > 0;
}

export async function restaurarData(id: number): Promise<DataDaEquipe | null> {
  await q`UPDATE datas_comemorativas SET apagada_em = NULL WHERE id = ${id}`;
  return dataPorId(id);
}

/**
 * Datas do §12.4 e da equipe que caem na janela pedida. Serve para o `status_do_mes`
 * e o `proximas_datas` proporem pauta sem inventar data.
 */
export async function proximasDatas(dias = 45): Promise<{ emDias: number; ocasiao: string; porque: string }[]> {
  const datas = await todasAsDatas();
  const achados: { emDias: number; ocasiao: string; porque: string }[] = [];
  for (let d = 0; d <= dias; d++) {
    const { year, mmdd } = dataSP(new Date(Date.now() + d * 86400_000));
    for (const hit of datas) if (caiEm(hit, year, mmdd)) achados.push({ emDias: d, ocasiao: hit.nome, porque: hit.porque });
  }
  return achados;
}

/** Cada data que cai entre dois dias AAAA-MM-DD, inclusive, em ordem de dia. Para o calendário da tela. */
export async function datasEntre(de: string, ate: string): Promise<{ dia: string; data: DataComemorativa }[]> {
  const datas = (await todasAsDatas()).sort((a, b) => a.mmdd.localeCompare(b.mmdd));
  const achadas: { dia: string; data: DataComemorativa }[] = [];
  for (let ano = Number(de.slice(0, 4)); ano <= Number(ate.slice(0, 4)); ano++)
    for (const data of datas) {
      const dia = `${ano}-${data.mmdd}`;
      if (dia >= de && dia <= ate && caiEm(data, ano, data.mmdd) && diaExiste(data.mmdd, ano)) achadas.push({ dia, data });
    }
  return achadas;
}
