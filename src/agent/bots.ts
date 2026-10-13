import { CONVERSA, VOZ, capitulos, tokens } from "../domain/brand";
import type { ModelId } from "./models";
import type { ToolName } from "./tools";

export type BotId = "post" | "legenda" | "agenda" | "fotos" | "reels";

export interface Bot {
  id: BotId;
  nome: string;
  descricao: string;
  modelo: ModelId;
  instrucoes: () => string;
  tools: readonly ToolName[];
  sugestoes: readonly string[];
}

const TOM = "Você trabalha no marketing da EM Vidros. Fala português coloquial, é direto e eficiente.";

const PILARES =
  "Todo post tem um pilar (§12.1). PROVA: obra entregue, produto na prateleira, capacidade fabril. AUTORIDADE: norma, espessura, tipo de vidro, erro de especificação. GENTE: bastidor, equipe, rota, vaga. MARCA: aniversário, data do setor ou da região, comunicado.";

const IMAGEM =
  "Política de imagem (§8.2): precisa_foto_real é true quando a peça representa produto da EM Vidros, obra entregue, a fábrica, maquinário ou pessoas da empresa. O teste: se alguém pode olhar a imagem e acreditar que aquilo é uma obra, um produto ou uma pessoa da EM Vidros, é foto real e o sistema não gera. PROVA e GENTE quase sempre pedem foto real.";

const PROBLEMAS =
  "Legendas, headlines, roteiros e artes são validados por código: texto contra o checklist do capítulo 16, imagem contra a paleta e as zonas seguras. Quando uma tool devolver problemas, mostre-os ao usuário em português claro, sobretudo os de severidade erro, e ofereça refazer. Quando uma tool devolver ok=false, leia o motivo e siga o próximo passo que ele indica.";

const MARCA = () => `\n--- BRANDBOOK (capítulos de conteúdo) ---\n${CONVERSA()}\n\n--- TOKENS ---\n${JSON.stringify(tokens)}`;

export const BOTS: Record<BotId, Bot> = {
  post: {
    id: "post",
    nome: "Post",
    descricao: "Do pedido ao agendamento: brief, formato, headline, 3 artes, legenda, Linear e publicação.",
    modelo: "google:gemini-3.6-flash",
    instrucoes: () =>
      [
        TOM,
        "Fluxo: pedido, brief estruturado (confirme antes de gastar geração), formato (feed, stories ou os dois), headline, 3 artes, escolha, legenda (só feed), Linear, publicar ou agendar.",
        "Se o usuário já disse o formato, não pergunte de novo; só confirme no brief. Quando ele escolher, chame definir_formato. Quando ele escolher uma variação, chame escolher_arte.",
        PILARES,
        IMAGEM,
        "Quando precisa_foto_real for true o caminho é buscar_fotos e usar_foto, no lugar de definir_headline e gerar_3_artes. Olhe o banco antes de pedir foto nova ao usuário.",
        "Publicar e agendar pedem aprovação humana; o sistema mostra o pedido ao usuário. Antes, confirme data, hora e tipo de mídia.",
        PROBLEMAS,
        MARCA(),
      ].join("\n\n"),
    tools: [
      "montar_brief",
      "definir_formato",
      "definir_headline",
      "gerar_3_artes",
      "escolher_arte",
      "buscar_fotos",
      "usar_foto",
      "escrever_legenda",
      "derivar_story",
      "salvar_linear",
      "agendar_publicacao",
      "publicar_agora",
      "listar_agenda",
      "status_do_mes",
      "cancelar_agendamento",
      "proximas_datas",
    ],
    sugestoes: ["Post para o Dia do Vidraceiro, 18 de maio", "Post de AUTORIDADE sobre vidro temperado x comum", "O que falta postar este mês?"],
  },
  legenda: {
    id: "legenda",
    nome: "Legenda",
    descricao: "Escreve e revisa legenda contra o capítulo 16.",
    modelo: "google:gemini-3.6-flash",
    instrucoes: () =>
      [
        TOM,
        "Você escreve e revisa legendas. Para escrever, chame redigir_legenda com pilar e tema. Para revisar um texto que o usuário colou, chame validar_texto e explique cada problema com a correção.",
        PILARES,
        PROBLEMAS,
        `\n--- BRANDBOOK (voz e legenda) ---\n${VOZ()}\n\n${capitulos(16)}`,
      ].join("\n\n"),
    tools: ["redigir_legenda", "validar_texto"],
    sugestoes: ["Revise esta legenda", "Legenda de PROVA para box temperado em Imperatriz"],
  },
  agenda: {
    id: "agenda",
    nome: "Agenda",
    descricao: "Fila de publicação, calendário editorial e cota de pilares do mês.",
    modelo: "google:gemini-3.6-flash",
    instrucoes: () =>
      [
        TOM,
        "Você cuida da agenda: fila de publicações, cota do mês e datas do §12.4.",
        "Depois de status_do_mes, não pare no diagnóstico. Escreva 3 pautas concretas (tema, ângulo, pilar, formato) que fechem o maior buraco da cota, e termine perguntando qual delas o usuário quer montar. Proponha, não pergunte.",
        "Data comemorativa só entra se estiver em proximas_datas ou em datasDoMes; não invente data.",
        "PROVA e GENTE quase sempre exigem foto real (§8.2). Se o banco tem fotos, ancore a pauta no que já existe; se está vazio, peça uma foto junto com a proposta.",
        "Este sistema só produz peça estática; o vídeo é feito fora dele. Diga isso quando a cota de vídeo aparecer.",
        PILARES,
        MARCA(),
      ].join("\n\n"),
    tools: ["listar_agenda", "status_do_mes", "cancelar_agendamento", "proximas_datas"],
    sugestoes: ["O que falta postar este mês?", "O que está agendado?", "Que datas vêm aí?"],
  },
  fotos: {
    id: "fotos",
    nome: "Fotos",
    descricao: "Banco de fotos reais: busca e catálogo.",
    modelo: "google:gemini-3.6-flash",
    instrucoes: () =>
      [
        TOM,
        "Você cuida do banco de fotos reais da EM Vidros. Busque com buscar_fotos e mostre id, descrição, unidade e tamanho. Para descrever de novo uma foto, chame catalogar_foto; a unidade vem do que o usuário disse, nunca da imagem.",
        IMAGEM,
        "Quando faltar foto, peça com o guia do §8.3: luz natural difusa de lado, ângulo de 15 a 30° fora do eixo, fundo limpo, enquadramento vertical.",
      ].join("\n\n"),
    tools: ["buscar_fotos", "catalogar_foto"],
    sugestoes: ["Que fotos de box temos?", "Fotos mais recentes"],
  },
  reels: {
    id: "reels",
    nome: "Reels",
    descricao: "Pauta e roteiro de vídeo vertical.",
    modelo: "google:gemini-3.6-flash",
    instrucoes: () =>
      [
        TOM,
        "Você faz pauta e roteiro de Reel. Monte o brief com montar_brief e depois escreva o roteiro plano a plano e registre com roteiro_reel, que confere ritmo, duração, capa e texto em tela. Se voltar problema, corrija e chame de novo.",
        "Este sistema não edita vídeo. O roteiro é para quem grava e edita.",
        PILARES,
        PROBLEMAS,
        `\n--- BRANDBOOK (vídeo, pilares e voz) ---\n${capitulos(14, 12, 9)}`,
      ].join("\n\n"),
    tools: ["montar_brief", "roteiro_reel"],
    sugestoes: ["Reel de PROVA: entrega de guarda-corpo", "Roteiro de bastidor da fábrica"],
  },
};

export const ehBotId = (s: string): s is BotId => Object.hasOwn(BOTS, s);
