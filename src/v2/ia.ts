import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import sharp from "sharp";
import { z } from "zod";
import { PILARES } from "../domain/art/pipeline";
import { MODELO_DE_IMAGEM, MODELO_DE_TEXTO } from "../openai";
import { fetchQueConta } from "../domain/uso";
import { FORMATOS, Plano, type Formato } from "./camadas";
import { Elementos, type Area } from "./separar";

/** Tudo o que o backend novo pede a um modelo. Os testes trocam por uma versão falsa. */
export interface Ia {
  lerReferencia(imagem: Uint8Array, tipo: string): Promise<LeituraDaReferencia>;
  /** Cataloga uma peça pronta: o texto pintado nela, o tema e o pilar. */
  lerPecaPronta(imagem: Uint8Array, tipo: string): Promise<LeituraDaPeca>;
  planejarArte(pedido: string, formato: Formato, leituras: string[]): Promise<Plano>;
  /** Devolve a cena já no tamanho final do formato, em JPEG. */
  gerarCena(prompt: string, formato: Formato): Promise<Uint8Array>;
  /** Acha os textos e o logo de uma imagem pronta, já no tamanho final do formato. */
  lerElementos(imagem: Uint8Array, formato: Formato): Promise<Elementos>;
  /** Apaga as áreas e completa com o fundo em volta. Devolve a imagem inteira redesenhada, no tamanho do modelo. */
  apagarAreas(imagem: Uint8Array, formato: Formato, areas: Area[]): Promise<Uint8Array>;
}

export const LeituraDaReferencia = z.object({ leitura: z.string(), pilares: z.array(z.enum(PILARES)) });
export type LeituraDaReferencia = z.infer<typeof LeituraDaReferencia>;

export const LeituraDaPeca = z.object({ texto: z.string(), tema: z.string(), pilar: z.enum(PILARES) });
export type LeituraDaPeca = z.infer<typeof LeituraDaPeca>;

/** Tamanho pedido ao modelo de imagem: mesma proporção do formato, lados múltiplos de 16. */
const TAMANHO_DA_GERACAO: Record<Formato, `${number}x${number}`> = { feed: "1024x1280", story: "1008x1792" };

/** Fração de cima da cena que fica vazia para o título e o apoio. A story tem 250 px de zona segura antes do texto. */
const TOPO_LIVRE: Record<Formato, number> = { feed: 35, story: 42 };

const comComposicao = (prompt: string, formato: Formato) =>
  `${prompt}\n\nHard composition rule: the top ${TOPO_LIVRE[formato]}% of the canvas is plain flat #F0EFEA background with nothing drawn on it. Every shape and object stays below that line. Keep the bottom-right corner empty.`;

const INSTRUCOES_DA_LEITURA = `
Você analisa artes de Instagram que a equipe da EM Vidros, uma vidraçaria, guardou como referência. O modelo de imagem recebe a própria arte junto da sua leitura e segue o visual dela.
Em leitura, escreva em português do Brasil o que uma arte nova deve tirar desta no visual: a paleta e onde cada cor entra, a composição e onde fica o foco, o par de fontes e o contraste de peso, o tipo de imagem ou ilustração e o acabamento.
Não transcreva o texto da arte nem descreva o assunto dela. Fale do visual, não do objeto.
Até 6 frases curtas, sem lista, sem título, sem elogio.
Em pilares, diga para quais pilares de conteúdo a peça serve. Pode ser mais de um, ou nenhum:
- PROVA: obra entregue, produto, pronta entrega, capacidade da fábrica, antes e depois, detalhe de acabamento.
- AUTORIDADE: tipos de vidro, espessura, norma, erro comum de especificação, manutenção, aplicação por ambiente.
- GENTE: bastidor, rota de entrega, equipe, vaga, aniversário de colaborador, treinamento.
- MARCA: aniversário da empresa, data do setor, data cívica ou religiosa da região, campanha institucional, comunicado.
`.trim();

const INSTRUCOES_DA_PECA = `
Você cataloga uma arte de Instagram que a equipe da EM Vidros, uma vidraçaria, fez fora do app e vai publicar como está. A equipe e o Chefe acham a peça por esta leitura, então seja concreto.
- texto: o texto pintado na arte, copiado exatamente, com acento e maiúscula, cada bloco numa linha. Sem o logo. Vazio se não houver texto.
- tema: do que a peça fala, em uma frase curta em português do Brasil, com o assunto, a ocasião e a data se aparecerem. Comece com maiúscula. Exemplo: "Convite para o café da manhã com vidraceiros em 28 de novembro".
- pilar: o pilar de conteúdo que a peça cumpre, um só:
  - PROVA: obra entregue, produto, pronta entrega, capacidade da fábrica, antes e depois, detalhe de acabamento.
  - AUTORIDADE: tipos de vidro, espessura, norma, erro comum de especificação, manutenção, aplicação por ambiente.
  - GENTE: bastidor, rota de entrega, equipe, vaga, aniversário de colaborador, treinamento, evento com clientes.
  - MARCA: aniversário da empresa, data do setor, data cívica ou religiosa da região, campanha institucional, comunicado.
`.trim();

const INSTRUCOES_DO_PLANO = `
Você planeja uma arte de Instagram para a EM Vidros, uma vidraçaria. A arte é uma cena gerada por IA com camadas de texto e o logo por cima.
Você devolve o prompt da cena e os textos. A cena vai sozinha para o modelo de imagem, sem esta conversa, então escreva o prompt completo.

Regras da cena:
- Nunca texto, letras, números ou logo dentro da cena.
- Deixe o terço de cima calmo e limpo, porque o título entra ali, e o canto inferior direito livre para o logo.
- Nunca uma foto que pareça registro real de obra, produto da EM Vidros, fábrica, máquina ou pessoa da empresa. Fundo abstrato, textura, cena conceitual e ilustração são permitidos.
- Visual chapado e fosco. Sem render 3D brilhante, sem reflexo especular, sem sombra projetada, sem gradiente de fundo.
- Só estas cores: #2F646A, #63B5AF, #414141, #FFFFFF, #F0EFEA, #E4E1D8, #D8D5CE, #8A8A8A.

Regras do texto:
- Título com até 8 palavras, apoio com até 16 palavras ou null. Português do Brasil, sem ponto de exclamação, sem emoji.

As leituras abaixo descrevem artes que a equipe considera bem pensadas. Siga os princípios delas, nunca copie o visual nem o assunto.
`.trim();

const INSTRUCOES_DOS_ELEMENTOS = (largura: number, altura: number) => `
Você recebe uma arte de Instagram pronta, com ${largura}×${altura} px. O texto foi desenhado dentro da imagem e o logo da EM Vidros foi colado por cima.
Ache cada bloco de texto e o logo, para a equipe editar cada um separado.
- Um bloco é um trecho com a mesma fonte, tamanho e cor: o título é um bloco, a linha de apoio é outro. Linhas do mesmo bloco ficam juntas, com \\n onde a linha quebra.
- Copie o texto exatamente como está na imagem, com acento e maiúscula.
- Um bloco com rótulo em negrito seguido de texto normal, como "Uso: indicado em...", fica um bloco só, com o peso do texto normal.
- x, y, largura e altura são a caixa justa em volta do bloco, em px desta imagem, com a origem no canto de cima à esquerda.
- O alinhamento sai das bordas das linhas: esquerda quando todas começam no mesmo x, direita quando todas terminam no mesmo x, centro só quando as duas bordas variam em volta do mesmo meio.
- O logo tem o símbolo EM e a palavra VIDROS. A caixa dele cobre só o logo, sem o selo. Se não houver logo, logo é null.
- Não conte como texto letras que fazem parte de uma foto ou ilustração, como placas e embalagens.
`.trim();

const PROMPT_DE_APAGAR =
  "Remove all text, letters and logos inside the transparent areas of the mask, including any badge or box behind a logo. Fill those areas with the background that surrounds them, continuing its colour, texture, light and shapes. Keep everything outside the mask exactly as it is. Do not add any new text, logo or object.";

/** `chave` é lida a cada pedido: a equipe pode trocar a chave com o servidor no ar. */
export function iaDaOpenAI(chave: () => Promise<string | undefined>): Ia {
  const cliente = async () => new OpenAI({ apiKey: (await chave()) ?? "", fetch: fetchQueConta("Estúdio de artes", MODELO_DE_IMAGEM) });
  return {
    async lerReferencia(imagem, tipo) {
      const resposta = await (await cliente()).responses.parse({
        model: MODELO_DE_TEXTO,
        reasoning: { effort: "medium" },
        instructions: INSTRUCOES_DA_LEITURA,
        input: [
          {
            role: "user",
            content: [{ type: "input_image", detail: "high", image_url: `data:${tipo};base64,${Buffer.from(imagem).toString("base64")}` }],
          },
        ],
        text: { format: zodTextFormat(LeituraDaReferencia, "leitura") },
      });
      if (!resposta.output_parsed) throw new Error("O modelo não devolveu a leitura da referência.");
      return { leitura: resposta.output_parsed.leitura.trim(), pilares: resposta.output_parsed.pilares };
    },

    async lerPecaPronta(imagem, tipo) {
      const resposta = await (await cliente()).responses.parse({
        model: MODELO_DE_TEXTO,
        reasoning: { effort: "low" },
        instructions: INSTRUCOES_DA_PECA,
        input: [
          {
            role: "user",
            content: [{ type: "input_image", detail: "high", image_url: `data:${tipo};base64,${Buffer.from(imagem).toString("base64")}` }],
          },
        ],
        text: { format: zodTextFormat(LeituraDaPeca, "leitura") },
      });
      if (!resposta.output_parsed) throw new Error("O modelo não devolveu a leitura da peça pronta.");
      const { texto, tema, pilar } = resposta.output_parsed;
      return { texto: texto.trim(), tema: tema.trim(), pilar };
    },

    async planejarArte(pedido, formato, leituras) {
      const resposta = await (await cliente()).responses.parse({
        model: MODELO_DE_TEXTO,
        reasoning: { effort: "medium" },
        instructions: `${INSTRUCOES_DO_PLANO}\n\n${leituras.map((l, i) => `Leitura ${i + 1}: ${l}`).join("\n\n") || "Nenhuma leitura ainda."}`,
        input: `Formato: ${formato}. Pedido: ${pedido}`,
        text: { format: zodTextFormat(Plano, "plano") },
      });
      if (!resposta.output_parsed) throw new Error("O modelo não devolveu o plano da arte.");
      return resposta.output_parsed;
    },

    async gerarCena(prompt, formato) {
      const resposta = await (await cliente()).images.generate({
        model: MODELO_DE_IMAGEM,
        prompt: comComposicao(prompt, formato),
        size: TAMANHO_DA_GERACAO[formato],
        quality: "medium",
        output_format: "jpeg",
      });
      const base64 = resposta.data?.[0]?.b64_json;
      if (!base64) throw new Error("O modelo de imagem não devolveu a cena.");
      const { largura, altura } = FORMATOS[formato];
      return sharp(Buffer.from(base64, "base64")).resize(largura, altura, { fit: "cover" }).jpeg({ quality: 90 }).toBuffer();
    },

    async lerElementos(imagem, formato) {
      const { largura, altura } = FORMATOS[formato];
      const jpeg = await sharp(imagem).resize(largura, altura, { fit: "fill" }).jpeg({ quality: 90 }).toBuffer();
      const resposta = await (await cliente()).responses.parse({
        model: MODELO_DE_TEXTO,
        reasoning: { effort: "medium" },
        instructions: INSTRUCOES_DOS_ELEMENTOS(largura, altura),
        input: [{ role: "user", content: [{ type: "input_image", detail: "high", image_url: `data:image/jpeg;base64,${jpeg.toString("base64")}` }] }],
        text: { format: zodTextFormat(Elementos, "elementos") },
      });
      if (!resposta.output_parsed) throw new Error("O modelo não devolveu os elementos da imagem.");
      return resposta.output_parsed;
    },

    async apagarAreas(imagem, formato, areas) {
      const [w, h] = TAMANHO_DA_GERACAO[formato].split("x").map(Number) as [number, number];
      const { largura, altura } = FORMATOS[formato];
      const [ex, ey] = [w / largura, h / altura];
      // Na máscara, o transparente é o que o modelo refaz; o resto fica opaco.
      const alfa = Buffer.alloc(w * h, 255);
      for (const a of areas) {
        const x0 = Math.floor(a.x * ex);
        const x1 = Math.min(w, Math.ceil((a.x + a.largura) * ex));
        for (let y = Math.floor(a.y * ey); y < Math.min(h, Math.ceil((a.y + a.altura) * ey)); y++) alfa.fill(0, y * w + x0, y * w + x1);
      }
      const mascara = await sharp({ create: { width: w, height: h, channels: 3, background: "#000" } })
        .joinChannel(alfa, { raw: { width: w, height: h, channels: 1 } })
        .png()
        .toBuffer();
      // Com qualidade alta e output_format png, o modelo devolveu as áreas transparentes em vez de preenchidas.
      const resposta = await (await cliente()).images.edit({
        model: MODELO_DE_IMAGEM,
        image: await toFile(await sharp(imagem).resize(w, h, { fit: "fill" }).png().toBuffer(), "arte.png", { type: "image/png" }),
        mask: await toFile(mascara, "mascara.png", { type: "image/png" }),
        prompt: PROMPT_DE_APAGAR,
        size: TAMANHO_DA_GERACAO[formato],
        quality: "medium",
      });
      const base64 = resposta.data?.[0]?.b64_json;
      if (!base64) throw new Error("O modelo de imagem não devolveu a imagem sem os textos.");
      return Buffer.from(base64, "base64");
    },
  };
}
