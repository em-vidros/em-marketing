/**
 * Manda para o Telegram a revisão que já está aberta no banco. Isto não cabe na
 * transação do concluir: álbum é efeito externo, e efeito externo dentro de
 * transação ou segura o banco pelo tempo da rede ou some quando ela dá rollback.
 *
 * Roda num laço só, o mesmo tique do reconciliador, nunca um por papel: dois
 * laços apresentando o mesmo fluxo disputariam a chave. A chave é
 * fluxo:stage:rodada:apresentacao, sob repetirSeFalhou, porque álbum duplicado
 * incomoda e álbum nunca enviado deixa o Ricardo esperando por trabalho pronto.
 */

import type { Adaptadores } from "../adaptadores/tipos";
import type { ControlePlano, ResumoArtefato, RevisaoAberta } from "../controle/api";
import { codificar } from "../controle/aprovacoes";
import type { AcaoCallback } from "../controle/aprovacoes";
import { EfeitoIndeterminado } from "../controle/idempotencia";
import type { DirecaoVisual, Estagio, FluxoId, VersaoId } from "../modelos/tipos";
import { direcoesDoArtefato } from "./designer";

interface Botao {
  text: string;
  callback_data: string;
}

const ROTULO_FORMATO: Record<string, string> = {
  feed: "Feed",
  stories: "Stories",
  both: "Feed e Stories",
  blog: "Blog",
};

function botao(
  texto: string,
  r: RevisaoAberta,
  acao: AcaoCallback,
  opcao?: VersaoId,
): Botao {
  return {
    text: texto,
    callback_data: codificar({
      fluxoId: r.fluxoId,
      stage: r.stage,
      acao,
      rodada: r.rodada,
      ...(opcao ? { opcao } : {}),
    }),
  };
}

function previewDe(
  artefatos: readonly ResumoArtefato[],
  masterId: VersaoId,
): ResumoArtefato | null {
  let achado: ResumoArtefato | null = null;
  for (const a of artefatos) if (a.papel === "preview" && a.derivadaDe === masterId) achado = a;
  return achado;
}

function direcaoDe(
  artefatos: readonly ResumoArtefato[],
  master: ResumoArtefato,
): DirecaoVisual | null {
  const id = master.meta?.direction_id;
  for (const a of artefatos) {
    if (a.papel !== "direcao") continue;
    const achada = direcoesDoArtefato(a).find((d) => d.direction_id === id);
    if (achada) return achada;
  }
  return null;
}

function brief(r: RevisaoAberta, titulo: string): string {
  const formato = ROTULO_FORMATO[r.pedido.format] ?? r.pedido.format;
  const objetivo = r.pedido.objective ? `\nObjetivo: ${r.pedido.objective}` : "";
  return `${titulo}\n\nTema: ${r.pedido.theme}\nFormato: ${formato}${objetivo}\nRodada ${r.rodada}`;
}

async function apresentarPrototipo(
  o: { controle: ControlePlano; adaptadores: Adaptadores },
  r: RevisaoAberta,
  artefatos: readonly ResumoArtefato[],
): Promise<void> {
  const mestres = r.versoes
    .map((id) => artefatos.find((a) => a.id === id))
    .filter((a): a is ResumoArtefato => a?.papel === "master");
  if (mestres.length === 0) throw new Error(`revisão de ${r.fluxoId} sem nenhum mestre para mostrar`);

  const previas = mestres.map((m) => {
    const p = previewDe(artefatos, m.id);
    if (!p) throw new Error(`mestre ${m.id} sem preview para o álbum`);
    return o.controle.lerArtefato(p.id).bytes;
  });
  const unica = mestres.length === 1;
  await o.adaptadores.telegram.enviarAlbum(
    r.chatId,
    previas,
    brief(r, unica ? "Versão ajustada para você revisar." : "Três caminhos para você escolher."),
  );

  const linhas = mestres.map((m, i) => {
    const d = direcaoDe(artefatos, m);
    const rotulo = unica ? "Nova versão" : `v${i + 1}`;
    return d ? `${rotulo}: ${d.territory}\n${d.rationale}` : `${rotulo}: peça sem direção registrada`;
  });
  const texto = [
    linhas.join("\n\n"),
    r.aviso ?? "",
    unica
      ? "Aceite para seguir, ou peça outro ajuste."
      : "Aceite uma opção, peça ajuste em uma delas, ou recuse as três.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const teclado: Botao[][] = [
    mestres.map((m, i) => botao(unica ? "Aceitar" : `Aceitar v${i + 1}`, r, "aceitar", m.id)),
    mestres.map((m, i) => botao(unica ? "Ajustar" : `Ajustar v${i + 1}`, r, "ajustar", m.id)),
    [botao("Recusar todas", r, "recusar_todas"), botao("Cancelar", r, "cancelar")],
  ];
  await o.adaptadores.telegram.enviarMensagem(r.chatId, texto, {
    reply_markup: { inline_keyboard: teclado },
  });
}

async function apresentarPacote(
  o: { controle: ControlePlano; adaptadores: Adaptadores },
  r: RevisaoAberta,
  artefatos: readonly ResumoArtefato[],
): Promise<void> {
  const cobertos = r.versoes
    .map((id) => artefatos.find((a) => a.id === id))
    .filter((a): a is ResumoArtefato => a !== undefined);
  const feed = cobertos.find((a) => a.papel === "master" && a.formato === "feed") ?? null;
  const stories = cobertos.find((a) => a.papel === "master" && a.formato === "stories") ?? null;
  const copy = cobertos.find((a) => a.papel === "copy") ?? null;
  const pecas = [feed, stories].filter((a): a is ResumoArtefato => a !== null);
  if (pecas.length === 0) throw new Error(`pacote de ${r.fluxoId} sem nenhuma peça para mostrar`);

  const previas = pecas.map((m) => {
    const p = previewDe(artefatos, m.id);
    if (!p) throw new Error(`mestre ${m.id} sem preview para o álbum`);
    return o.controle.lerArtefato(p.id).bytes;
  });
  await o.adaptadores.telegram.enviarAlbum(
    r.chatId,
    previas,
    brief(r, pecas.length === 2 ? "Pacote pronto: Feed e Stories." : "Pacote pronto."),
  );

  if (copy) {
    await o.adaptadores.telegram.enviarMensagem(
      r.chatId,
      o.controle.lerArtefato(copy.id).bytes.toString("utf8"),
    );
  }

  const ajustes: Botao[] = [];
  if (feed) ajustes.push(botao("Ajustar Feed", r, "ajustar", feed.id));
  if (stories) ajustes.push(botao("Ajustar Stories", r, "ajustar", stories.id));
  if (copy) ajustes.push(botao("Ajustar legenda", r, "ajustar", copy.id));
  const teclado: Botao[][] = [
    [botao("Aceitar pacote", r, "aceitar")],
    ajustes,
    [botao("Recusar", r, "encerrar"), botao("Cancelar", r, "cancelar")],
  ].filter((linha) => linha.length > 0);

  const texto = [
    r.aviso ?? "",
    "Se aceitar, eu mando o arquivo mestre para você baixar e publicar.",
  ]
    .filter(Boolean)
    .join("\n\n");
  await o.adaptadores.telegram.enviarMensagem(r.chatId, texto, {
    reply_markup: { inline_keyboard: teclado },
  });
}

const APRESENTADORES: Partial<
  Record<
    Estagio,
    (
      o: { controle: ControlePlano; adaptadores: Adaptadores },
      r: RevisaoAberta,
      artefatos: readonly ResumoArtefato[],
    ) => Promise<void>
  >
> = {
  prototype: apresentarPrototipo,
  package: apresentarPacote,
};

export function chaveDaApresentacao(fluxoId: FluxoId, stage: Estagio, rodada: number): string {
  return `${fluxoId}:${stage}:${rodada}:apresentacao`;
}

/** Devolve quantas revisões foram apresentadas agora; as já apresentadas não contam. */
export async function apresentarRevisoes(o: {
  controle: ControlePlano;
  adaptadores: Adaptadores;
}): Promise<number> {
  let enviadas = 0;
  for (const r of o.controle.revisoesAbertas()) {
    const apresentar = APRESENTADORES[r.stage];
    if (!apresentar) continue;
    const chave = chaveDaApresentacao(r.fluxoId, r.stage, r.rodada);
    try {
      const feito = await o.controle.executarUmaVez(
        chave,
        async () => {
          await apresentar(o, r, o.controle.artefatosDoFluxo(r.fluxoId));
          return { apresentado: true };
        },
        { repetirSeFalhou: true },
      );
      if (feito.novo) enviadas++;
    } catch (erro) {
      // Uma revisão travada não pode parar as outras, e insistir aqui viraria laço.
      const causa = erro instanceof EfeitoIndeterminado ? "chave travada" : "erro no envio";
      console.error(`apresentador: ${causa} em ${chave}: ${erro}`);
    }
  }
  return enviadas;
}
