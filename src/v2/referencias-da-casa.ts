import { readdirSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import type { Pilar } from "../domain/art/pipeline";
import type { Estudio } from "./artes";
import type { Banco } from "./banco";
import { referencias } from "./schema";

export const CRIADA_PELA_CASA = "casa";

const PASTA = "brand/referencias-posts";

/** Chave do pg_advisory_xact_lock: duas funções frias da Vercel sobem ao mesmo tempo e só uma semeia. */
const TRAVA_DA_SEMENTE = 410_001;

/** A leitura e os pilares de cada pasta de posts reais da @emvidros. */
const DA_CASA: Record<string, { leitura: string; pilares: Pilar[] }> = {
  "faixa-foto": {
    leitura:
      "Foto aspiracional de arquitetura nos dois terços de cima, com luz de fim de tarde ou de dia claro e o vidro como protagonista. Embaixo, uma faixa sólida em teal profundo, de borda reta ou com degradê suave saindo da foto. Na faixa, título em sans geométrica extra bold, branco e grande, com uma segunda linha em teal claro semibold. Às vezes entra uma pílula inclinada em teal claro com texto escuro em itálico bold. Acabamento limpo de anúncio imobiliário de alto padrão, sem pessoa identificável.",
    pilares: ["PROVA", "AUTORIDADE", "GENTE"],
  },
  "teal-chamada": {
    leitura:
      "Fundo teal rico e com profundidade: degradê suave, reflexos de painel de vidro ou linhas de arquitetura desfocadas, nunca chapado. Título em sans condensada pesada, toda em caixa alta, muito grande e branca, com as palavras-chave dentro de caixas em cinza escuro ou teal profundo. Às vezes uma linha curta de apoio em branco e uma seta num círculo chamando para deslizar. Um elemento de vidro 3D pode aparecer, mas o título domina. Tom direto e confiante, de rede social.",
    pilares: ["PROVA", "AUTORIDADE", "GENTE", "MARCA"],
  },
  "teal-parabens": {
    leitura:
      "Cena do tema em fundo inteiro, convertida em duotone teal, das sombras quase pretas aos realces em teal claro, escurecida para o texto saltar. No centro, uma palavra manuscrita fluida em teal claro ou branco se sobrepõe a uma palavra grande em sans black, caixa alta e branca. Abaixo, uma ou duas linhas curtas em branco, peso regular, com números ou palavras-chave em bold. Clima elegante, emocional e institucional, sem pessoa identificável.",
    pilares: ["GENTE", "MARCA"],
  },
  "vidro-3d": {
    leitura:
      "Um único objeto herói em vidro 3D fotorrealista, transparente ou levemente teal, com bordas chanfradas grossas, refração e cáusticas suaves, como símbolo do tema. Fundo claro, do branco ao off-white, com degradê de estúdio e sombra de contato macia. Acentos 3D em teal ao redor, como cacos de vidro, esferas, chevrons ou grades de pontos. Título em sans condensada pesada, teal profundo, grande, no topo, com uma linha secundária em cinza escuro. Acabamento polido de agência, com detalhe alto e bordas nítidas.",
    pilares: ["PROVA", "AUTORIDADE", "MARCA"],
  },
};

/**
 * Põe os posts reais da @emvidros na Biblioteca como referências comuns, uma vez só.
 * Depois da primeira vez, nada volta: uma referência da casa que a equipe removeu continua removida.
 */
export async function semearReferenciasDaCasa({ banco, arquivos }: Pick<Estudio, "banco" | "arquivos">): Promise<void> {
  if (await jaSemeada(banco)) return;

  await banco.transaction(async (transacao) => {
    await transacao.execute(sql`SELECT pg_advisory_xact_lock(${TRAVA_DA_SEMENTE})`);
    if (await jaSemeada(transacao)) return;

    const novas = await Promise.all(
      postsDaCasa().map(async ({ caminho, leitura, pilares }) => ({
        arquivo: await arquivos.salvar(await Bun.file(caminho).bytes(), "jpg"),
        leitura,
        pilares,
        criadaPor: CRIADA_PELA_CASA,
      })),
    );
    await transacao.insert(referencias).values(novas);
  });
}

async function jaSemeada(banco: Pick<Banco, "select">): Promise<boolean> {
  const [alguma] = await banco.select({ id: referencias.id }).from(referencias).where(eq(referencias.criadaPor, CRIADA_PELA_CASA)).limit(1);
  return alguma !== undefined;
}

function postsDaCasa() {
  return Object.entries(DA_CASA).flatMap(([pasta, { leitura, pilares }]) =>
    readdirSync(`${PASTA}/${pasta}`)
      .filter((nome) => nome.endsWith(".jpg"))
      .sort()
      .map((nome) => ({ caminho: `${PASTA}/${pasta}/${nome}`, leitura, pilares })),
  );
}
