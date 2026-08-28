/**
 * O caminho do Ricardo inteiro, dirigido por updates sintéticos do Telegram.
 *
 * A suíte de workers prova o que acontece depois da decisão; esta prova o que o
 * Ricardo vê e toca: a conversa, os botões e a ordem das mensagens. Por isso nada
 * aqui chama criarFluxo, confirmarBrief ou aoCallback direto. Tudo entra por
 * `conversa.tratar(update)`, no formato da Bot API, e sai pelo que a porta falsa
 * do Telegram registrou.
 *
 * Offline com adaptadores falsos: o mesmo tema devolve sempre os mesmos bytes, e
 * as contagens são exatas.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakePortaLinear, FakePortaTelegram } from "../../src/adaptadores/fake";
import { carregarAdaptadores } from "../../src/adaptadores/index";
import type { Adaptadores } from "../../src/adaptadores/tipos";
import { criarControle } from "../../src/controle/api";
import { decodificar } from "../../src/controle/aprovacoes";
import type { FluxoId, Papel } from "../../src/modelos/tipos";
import { criarConversa } from "../../src/telegram/conversa";
import { apresentarRevisoes } from "../../src/workers/apresentador";
import type { OpcoesWorkers } from "../../src/workers/laco";
import { rodarAteEsvaziar } from "../../src/workers/laco";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FALHOU: ${msg}`);
    process.exit(1);
  }
}

const RICARDO = 111;
const ESTRANHO = 222;
const CHAT = 4242;
const PAPEIS: readonly Papel[] = [
  "diretor_criativo",
  "redator",
  "designer",
  "diretor_de_arte",
  "operacoes",
];

/** A conversa engole erro de tratamento para não derrubar o webhook; aqui isso é falha. */
const erros: string[] = [];
const errarDeVerdade = console.error.bind(console);
console.error = (...args: unknown[]) => {
  erros.push(args.map(String).join(" "));
  errarDeVerdade(...args);
};

const raiz = mkdtempSync(join(tmpdir(), "em-mkt-ponta-"));
const adaptadores: Adaptadores = carregarAdaptadores();
const telegram = adaptadores.telegram as FakePortaTelegram;
const linear = adaptadores.linear as FakePortaLinear;
const controle = criarControle({
  caminhoDb: join(raiz, "t.db"),
  adaptadores,
  aprovadorId: RICARDO,
  artefatosDir: join(raiz, "artefatos"),
});
const conversa = criarConversa({
  entrada: controle.paraTelegram,
  telegram: adaptadores.telegram,
  aprovadorId: RICARDO,
});

interface Falha {
  tipo: string;
  mensagem: string;
}
const falhas: Falha[] = [];
const opcoes: OpcoesWorkers = {
  controle: controle.paraWorkers,
  adaptadores,
  papeis: PAPEIS,
  aoFalhar: (_fluxoId, _chatId, tipo, mensagem) => falhas.push({ tipo, mensagem }),
};

const rodar = () => rodarAteEsvaziar(opcoes);
const apresentar = () => apresentarRevisoes({ controle: controle.paraWorkers, adaptadores });

// ---------------------------------------------------------------------------
// Updates sintéticos e leitura do que a porta falsa registrou
// ---------------------------------------------------------------------------

let seq = 0;
const de = (id: number) => ({ id, is_bot: false, first_name: "quem" });

const msg = (texto: string, deId = RICARDO) => ({
  update_id: ++seq,
  message: {
    message_id: ++seq,
    date: 1_700_000_000,
    from: de(deId),
    chat: { id: CHAT, type: "private" },
    text: texto,
  },
});

const toque = (data: string, deId = RICARDO) => ({
  update_id: ++seq,
  callback_query: {
    id: `cbq-${++seq}`,
    from: de(deId),
    chat_instance: "instancia",
    data,
    message: { message_id: ++seq, date: 1_700_000_000, chat: { id: CHAT, type: "private" } },
  },
});

interface Botao {
  text: string;
  callback_data: string;
}

const chamadas = (metodo: string) => telegram.chamadas.filter((c) => c.metodo === metodo);
const ultima = (metodo: string) => chamadas(metodo).at(-1);
const textoDaUltimaMensagem = () => String(ultima("enviarMensagem")?.texto ?? "");

function comTeclado(): { texto: string; teclado: Botao[][] } {
  const c = telegram.chamadas
    .filter((x) => x.metodo === "enviarMensagem" && (x.extra as { reply_markup?: unknown } | undefined)?.reply_markup)
    .at(-1);
  assert(c, "nenhuma mensagem com teclado foi enviada");
  const markup = c.extra as { reply_markup: { inline_keyboard: Botao[][] } };
  return { texto: String(c.texto), teclado: markup.reply_markup.inline_keyboard };
}

const rotulos = (teclado: Botao[][]) => teclado.flat().map((b) => b.text);

function porRotulo(teclado: Botao[][], texto: string): string {
  const achado = teclado.flat().find((b) => b.text === texto);
  assert(achado, `teclado sem o botão "${texto}": ${rotulos(teclado).join(", ")}`);
  return achado.callback_data;
}

/** Tudo que uma decisão poderia mexer, para provar que um botão recusado não mexeu em nada. */
const foto = (id: FluxoId) =>
  JSON.stringify([
    controle.inspecionar.fluxo(id),
    controle.inspecionar.tarefas(id),
    controle.inspecionar.artefatos(id),
    controle.inspecionar.entregas(id),
  ]);

const estadoDe = (id: FluxoId) => controle.inspecionar.fluxo(id)!.estado;
const etapaDaConversa = () => controle.paraTelegram.conversa.ler(CHAT).etapa;

function fluxoAtivo(): FluxoId {
  const f = controle.paraTelegram.fluxoAtivoDoChat(CHAT);
  assert(f, "o chat ficou sem fluxo ativo");
  return f.id;
}

// ---------------------------------------------------------------------------
// 0. Update malformado não derruba nada
// ---------------------------------------------------------------------------
{
  const lixo: unknown[] = [
    null,
    42,
    "texto solto",
    [],
    { update_id: 1 },
    { message: { text: "sem chat" } },
    { message: { chat: { id: CHAT }, text: "sem remetente" } },
    { message: { chat: { id: CHAT }, from: { id: RICARDO } } },
    { message: { chat: { id: CHAT }, from: { id: RICARDO }, text: "   " } },
    { callback_query: { id: "x", from: { id: RICARDO }, data: "a|" } },
  ];
  const antes = telegram.chamadas.length;
  for (const u of lixo) await conversa.tratar(u);
  assert(telegram.chamadas.length === antes, "update malformado gerou resposta");
  assert(erros.length === 0, `update malformado logou erro: ${erros.join(" | ")}`);
  console.log("ok\t0. update malformado é ignorado, sem resposta e sem erro");
}

// ---------------------------------------------------------------------------
// 1 a 3. Tema, formato e brief
// ---------------------------------------------------------------------------
await conversa.tratar(msg("/start"));
assert(
  textoDaUltimaMensagem().includes("tema do post"),
  `/start respondeu "${textoDaUltimaMensagem()}"`,
);

await conversa.tratar(msg("Guarda-corpo de vidro para sacada"));
{
  const { texto, teclado } = comTeclado();
  assert(texto === "Feed, Stories ou os dois?", `pergunta de formato saiu como "${texto}"`);
  assert(teclado.flat().length === 3, `${teclado.flat().length} botões de formato, esperava 3`);
  assert(
    JSON.stringify(teclado.flat().map((b) => b.callback_data)) ===
      JSON.stringify(["c|f|feed", "c|f|stories", "c|f|both"]),
    "os botões de formato não usam o codec c|f|<formato>",
  );
}
console.log("ok\t1-2. /start pede o tema e o tema pergunta o formato");

await conversa.tratar(toque("c|f|both"));
const id = fluxoAtivo();
{
  assert(estadoDe(id) === "requested", `depois do formato o fluxo está em ${estadoDe(id)}`);
  const { texto, teclado } = comTeclado();
  assert(texto.includes("Guarda-corpo de vidro para sacada"), "o brief não repete o tema");
  assert(texto.includes("Feed e Stories"), "o brief não diz o formato escolhido");
  assert(
    JSON.stringify(rotulos(teclado)) === JSON.stringify(["Confirmar", "Cancelar"]),
    `teclado do brief: ${rotulos(teclado).join(", ")}`,
  );
  assert(porRotulo(teclado, "Confirmar") === `c|ok|${id}`, "Confirmar não aponta para o fluxo criado");
}
console.log("ok\t3. o formato cria o fluxo e o brief pede confirmação");

// ---------------------------------------------------------------------------
// 4. Confirmar: três prévias com o teclado de revisão
// ---------------------------------------------------------------------------
await conversa.tratar(toque(`c|ok|${id}`));
assert(estadoDe(id) === "brief_confirmed", `confirmar parou em ${estadoDe(id)}`);
await rodar();
assert(
  estadoDe(id) === "awaiting_prototype_review",
  `depois de rodar o fluxo está em ${estadoDe(id)}`,
);
await apresentar();

const tecladoRodada1 = comTeclado().teclado;
{
  const album = ultima("enviarAlbum");
  assert(album, "nenhum álbum foi enviado");
  assert((album.itens as unknown[]).length === 3, "o álbum não trouxe as três prévias");
  assert(
    JSON.stringify(rotulos(tecladoRodada1)) ===
      JSON.stringify([
        "Aceitar v1",
        "Aceitar v2",
        "Aceitar v3",
        "Ajustar v1",
        "Ajustar v2",
        "Ajustar v3",
        "Recusar todas",
        "Cancelar",
      ]),
    `teclado da revisão: ${rotulos(tecladoRodada1).join(", ")}`,
  );
  for (const b of tecladoRodada1.flat()) {
    assert(decodificar(b.callback_data), `callback_data indecifrável no botão ${b.text}`);
  }
}

await conversa.tratar(msg("/status"));
assert(
  textoDaUltimaMensagem() === "Esperando sua revisão das três prévias.",
  `/status na revisão disse "${textoDaUltimaMensagem()}"`,
);
console.log("ok\t4. três prévias num álbum, com teclado decifrável e /status em palavras");

// ---------------------------------------------------------------------------
// 5. Quem não é o aprovador não decide
// ---------------------------------------------------------------------------
const ajustarV2 = porRotulo(tecladoRodada1, "Ajustar v2");
{
  const antes = foto(id);
  await conversa.tratar(toque(ajustarV2, ESTRANHO));
  assert(
    ultima("responderCallback")?.texto === "Só o aprovador decide.",
    `o estranho ouviu "${ultima("responderCallback")?.texto}"`,
  );
  assert(foto(id) === antes, "o toque do estranho mexeu no fluxo");
  assert(etapaDaConversa() === "ociosa", "o toque do estranho abriu a espera por instrução");
}
console.log("ok\t5. botão de quem não é o aprovador é recusado e não muda nada");

// ---------------------------------------------------------------------------
// 6. Ajuste em linguagem natural: pergunta, texto, rodada nova
// ---------------------------------------------------------------------------
await conversa.tratar(toque(ajustarV2));
assert(
  textoDaUltimaMensagem().includes("O que você quer mudar na v2"),
  `pedido de instrução saiu como "${textoDaUltimaMensagem()}"`,
);
assert(etapaDaConversa() === "instrucao", "o ajuste não deixou a conversa esperando a instrução");

await conversa.tratar(msg("menos texto e o produto maior"));
assert(estadoDe(id) === "prototypes_generating", `depois da instrução o fluxo está em ${estadoDe(id)}`);
assert(controle.inspecionar.fluxo(id)!.rodada === 2, "a instrução não abriu a rodada 2");
assert(etapaDaConversa() === "ociosa", "a conversa ficou presa na espera por instrução");

await rodar();
await apresentar();
const tecladoRodada2 = comTeclado().teclado;
{
  const album = ultima("enviarAlbum");
  assert((album!.itens as unknown[]).length === 1, "a rodada de ajuste mandou mais de uma prévia");
  assert(
    JSON.stringify(rotulos(tecladoRodada2).slice(0, 2)) === JSON.stringify(["Aceitar", "Ajustar"]),
    `teclado da versão única: ${rotulos(tecladoRodada2).join(", ")}`,
  );
}
console.log("ok\t6. ajuste por texto vira rodada 2 com uma prévia só");

// ---------------------------------------------------------------------------
// 7. Teclado da rodada que já fechou
// ---------------------------------------------------------------------------
{
  const antes = foto(id);
  await conversa.tratar(toque(porRotulo(tecladoRodada1, "Aceitar v1")));
  assert(
    ultima("responderCallback")?.texto === "Esse botão é de uma rodada que já fechou.",
    `o botão velho respondeu "${ultima("responderCallback")?.texto}"`,
  );
  assert(foto(id) === antes, "o botão da rodada velha mexeu no fluxo");
}
console.log("ok\t7. botão da rodada anterior é recusado como vencido");

// ---------------------------------------------------------------------------
// 8. Aceitar a prévia: pacote com Feed, Stories e legenda
// ---------------------------------------------------------------------------
await conversa.tratar(toque(porRotulo(tecladoRodada2, "Aceitar")));
assert(estadoDe(id) === "package_finalizing", `o aceite parou em ${estadoDe(id)}`);
await rodar();
assert(estadoDe(id) === "awaiting_package_review", `o pacote parou em ${estadoDe(id)}`);

const antesDoPacote = telegram.chamadas.length;
await apresentar();
const tecladoPacote = comTeclado().teclado;
{
  const album = ultima("enviarAlbum");
  assert((album!.itens as unknown[]).length === 2, "o álbum do pacote não tem Feed e Stories");
  const legenda = telegram.chamadas
    .slice(antesDoPacote)
    .filter((c) => c.metodo === "enviarMensagem" && String(c.texto).includes("#EMVidros"));
  assert(legenda.length === 1, `${legenda.length} mensagens com a legenda, esperava 1`);
  assert(
    !(legenda[0]!.extra as { reply_markup?: unknown } | undefined)?.reply_markup,
    "a legenda saiu grudada num teclado, e ele quer copiar só o texto",
  );
  assert(
    JSON.stringify(rotulos(tecladoPacote)) ===
      JSON.stringify([
        "Aceitar pacote",
        "Ajustar Feed",
        "Ajustar Stories",
        "Ajustar legenda",
        "Recusar",
        "Cancelar",
      ]),
    `teclado do pacote: ${rotulos(tecladoPacote).join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// 9. /status no meio
// ---------------------------------------------------------------------------
await conversa.tratar(msg("/status"));
assert(
  textoDaUltimaMensagem() === "Esperando sua revisão do pacote.",
  `/status no pacote disse "${textoDaUltimaMensagem()}"`,
);
console.log("ok\t8-9. pacote com álbum de dois, legenda separada e /status do pacote");

// ---------------------------------------------------------------------------
// 10. Aceitar o pacote: documentos, aviso de publicar e link do Linear
// ---------------------------------------------------------------------------
const antesDaEntrega = telegram.chamadas.length;
await conversa.tratar(toque(porRotulo(tecladoPacote, "Aceitar pacote")));
assert(
  estadoDe(id) === "approved_for_manual_delivery",
  `o aceite do pacote parou em ${estadoDe(id)}`,
);
await rodar();
assert(estadoDe(id) === "archived", `depois da entrega o fluxo está em ${estadoDe(id)}`);
{
  const entregas = controle.inspecionar.entregas(id);
  assert(entregas.length === 2, `${entregas.length} entregas, esperava uma por mestre`);
  assert(
    entregas.every((e) => e.estado === "confirmada" && e.hashConferido?.length === 64),
    "entrega sem hash conferido",
  );

  const depois = telegram.chamadas.slice(antesDaEntrega);
  const iLegenda = depois.findIndex(
    (c) => c.metodo === "enviarMensagem" && String(c.texto).includes("pronta para copiar"),
  );
  const iDocumento = depois.findIndex((c) => c.metodo === "enviarDocumento");
  const documentos = depois.filter((c) => c.metodo === "enviarDocumento");
  assert(documentos.length === 2, `${documentos.length} documentos, esperava um por versão`);
  assert(iLegenda >= 0, "a legenda não foi mandada na entrega");
  assert(iLegenda < iDocumento, "a legenda saiu depois dos documentos");
  assert(
    depois.some((c) => c.metodo === "enviarMensagem" && String(c.texto).includes("pronto para publicar")),
    "ninguém disse que está pronto para publicar",
  );
  const ultimoTexto = String(depois.filter((c) => c.metodo === "enviarMensagem").at(-1)?.texto ?? "");
  assert(ultimoTexto.includes("linear.app"), `a última mensagem foi "${ultimoTexto}"`);
  assert(
    linear.chamadas.filter((c) => c.metodo === "criarIssue").length === 1,
    "o trabalho não virou uma issue única no Linear",
  );
}
console.log("ok\t10. entrega com documento por versão, legenda antes e link do Linear no fim");

// ---------------------------------------------------------------------------
// 11. Segundo pedido: depois de fechar funciona, com o anterior aberto avisa
// ---------------------------------------------------------------------------
await conversa.tratar(msg("Espelho bisotado para banheiro"));
assert(comTeclado().texto === "Feed, Stories ou os dois?", "o segundo pedido não perguntou o formato");
await conversa.tratar(toque("c|f|feed"));
const id2 = fluxoAtivo();
assert(id2 !== id, "o segundo pedido reaproveitou o fluxo do primeiro");
await conversa.tratar(toque(`c|ok|${id2}`));
assert(estadoDe(id2) === "brief_confirmed", `o segundo brief parou em ${estadoDe(id2)}`);

{
  const antes = foto(id2);
  await conversa.tratar(msg("Porta de correr em vidro"));
  assert(
    textoDaUltimaMensagem().includes("/cancelar"),
    `pedido em cima do aberto respondeu "${textoDaUltimaMensagem()}"`,
  );
  assert(foto(id2) === antes, "o tema novo mexeu no pedido que já estava aberto");
  assert(fluxoAtivo() === id2, "o tema novo abriu um segundo fluxo por cima do aberto");
}
console.log("ok\t11. pedido novo depois de fechar funciona; em cima do aberto vira aviso");

// ---------------------------------------------------------------------------
// 12. /cancelar com o fluxo esperando revisão
// ---------------------------------------------------------------------------
await rodar();
await apresentar();
assert(
  estadoDe(id2) === "awaiting_prototype_review",
  `o segundo pedido parou em ${estadoDe(id2)}`,
);
await conversa.tratar(msg("/cancelar"));
assert(estadoDe(id2) === "cancelled", `/cancelar deixou o fluxo em ${estadoDe(id2)}`);
{
  const vivas = controle.inspecionar
    .tarefas(id2)
    .filter((t) => t.estado === "pendente" || t.estado === "reivindicada");
  assert(vivas.length === 0, `${vivas.length} tarefa(s) viva(s) depois do cancelamento`);
  assert(etapaDaConversa() === "ociosa", "/cancelar não limpou a etapa da conversa");
  const antes = foto(id2);
  await rodar();
  await apresentar();
  assert(foto(id2) === antes, "o reconciliador ressuscitou o fluxo cancelado");
}
console.log("ok\t12. /cancelar na revisão cancela o fluxo e as tarefas, sem volta");

// ---------------------------------------------------------------------------
// 13. Dois toques no mesmo instante leem estados diferentes
// ---------------------------------------------------------------------------
{
  await conversa.tratar(msg("Fachada em pele de vidro"));
  const briefsAntes = chamadas("enviarMensagem").filter((c) =>
    String(c.texto).includes("Confirmo e começo?"),
  ).length;
  await Promise.all([conversa.tratar(toque("c|f|feed")), conversa.tratar(toque("c|f|feed"))]);
  const briefsDepois = chamadas("enviarMensagem").filter((c) =>
    String(c.texto).includes("Confirmo e começo?"),
  ).length;
  assert(
    briefsDepois - briefsAntes === 1,
    `dois toques simultâneos criaram ${briefsDepois - briefsAntes} pedidos`,
  );
  assert(
    ultima("responderCallback")?.texto === "Esse botão não vale mais.",
    "o segundo toque não foi tratado como botão vencido",
  );
}
console.log("ok\t13. dois toques no mesmo chat rodam em série e criam um pedido só");

assert(falhas.length === 0, `${falhas.length} falha(s) num caminho feliz: ${JSON.stringify(falhas)}`);
assert(erros.length === 0, `a conversa engoliu ${erros.length} erro(s): ${erros.join(" | ")}`);

controle.fechar();
rmSync(raiz, { recursive: true, force: true });
console.log("\nponta-a-ponta: ok");
