/**
 * Calendário editorial: as datas recorrentes que podem virar post.
 *
 * §12.4 é uma trava, não uma sugestão: uma data só vira post se passar em um de
 * três testes — (a) é do setor, (b) é da região onde há unidade, (c) é da
 * empresa. "Data que não passa em nenhum dos três não vira post."
 *
 * Por isso todo seed é obrigado a declarar em qual teste passa. A trava é
 * estrutural: sem `teste`, o TypeScript não compila e `validarSeeds` lança no
 * boot. Sem isso o calendário volta a semear Tiradentes e Dia das Mulheres,
 * como fazia antes deste commit.
 */

type Teste = "setor" | "regiao" | "empresa";

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

/**
 * Datas do §12.4 que caem na janela pedida. Serve para o `status_do_mes` propor
 * pauta de MARCA sem inventar data — se não está aqui, não passou na trava.
 */
export function proximasDatas(dias = 45): { emDias: number; ocasiao: string; porque: string }[] {
  const achados: { emDias: number; ocasiao: string; porque: string }[] = [];
  for (let d = 0; d <= dias; d++) {
    const { mmdd } = dataSP(new Date(Date.now() + d * 86400_000));
    const hit = SEEDS.find((s) => s.mmdd === mmdd);
    if (hit) achados.push({ emDias: d, ocasiao: hit.ocasiao, porque: hit.porque });
  }
  return achados;
}

/** Datas do §12.4 entre dois dias AAAA-MM-DD, inclusive, em ordem. Para o calendário da tela. */
export function datasEntre(de: string, ate: string): { dia: string; ocasiao: string }[] {
  const porDia = [...SEEDS].sort((a, b) => a.mmdd.localeCompare(b.mmdd));
  const achadas: { dia: string; ocasiao: string }[] = [];
  for (let ano = Number(de.slice(0, 4)); ano <= Number(ate.slice(0, 4)); ano++)
    for (const s of porDia) {
      const dia = `${ano}-${s.mmdd}`;
      if (dia >= de && dia <= ate) achadas.push({ dia, ocasiao: s.ocasiao });
    }
  return achadas;
}
