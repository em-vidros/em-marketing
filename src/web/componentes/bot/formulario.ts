import type { CampoEditavel, DetalheBot, Editavel, VersaoBot } from "../../../agent/config";

export type { CampoEditavel, DetalheBot, Editavel, VersaoBot };

export const CAMPOS = ["nome", "descricao", "modelo", "prompt"] as const satisfies readonly CampoEditavel[];

/** Os limites da rota PUT /api/bots/:id/config, repetidos aqui para avisar antes de mandar. */
export const LIMITE = { nome: 40, descricao: 300, prompt: 20_000 } as const;

/**
 * O formulário de config de um bot. `salvo` é o que o servidor devolveu por último;
 * `rascunho` é o que está na tela. Sujo é derivado da diferença, nunca guardado à parte.
 * `descartado` guarda o último rascunho jogado fora, para o "Desfazer".
 */
export type Formulario =
  | { fase: "carregando" }
  | {
      fase: "pronto";
      salvo: DetalheBot;
      rascunho: Editavel;
      enviando: boolean;
      /** Erros por campo, só depois de tentar salvar. */
      problemas: Partial<Record<CampoEditavel, string>>;
      /** Erro do servidor, em português, como veio em {erro}. */
      erro: string | null;
      descartado: Editavel | null;
    };

export type Acao =
  | { tipo: "chegou"; detalhe: DetalheBot }
  | { tipo: "editar"; campo: CampoEditavel; valor: string }
  | { tipo: "descartar" }
  | { tipo: "recuperar" }
  | { tipo: "enviar"; problemas: Partial<Record<CampoEditavel, string>> }
  | { tipo: "falhou"; erro: string };

const editavel = ({ nome, descricao, modelo, prompt }: Editavel): Editavel => ({ nome, descricao, modelo, prompt });

/** Os campos que mudaram, para o PUT mandar só eles. Vazio quando nada mudou. */
export const mudanca = (salvo: Editavel, rascunho: Editavel): Partial<Editavel> =>
  Object.fromEntries(CAMPOS.filter((c) => rascunho[c] !== salvo[c]).map((c) => [c, rascunho[c]]));

export const sujo = (f: Formulario) => f.fase === "pronto" && CAMPOS.some((c) => f.rascunho[c] !== f.salvo[c]);

const conta = (n: number) => n.toLocaleString("pt-BR");

/** As mesmas regras do servidor, com o texto que a pessoa precisa para corrigir. */
export function problemasDe(r: Editavel): Partial<Record<CampoEditavel, string>> {
  const p: Partial<Record<CampoEditavel, string>> = {};
  const texto = (campo: "nome" | "descricao" | "prompt", rotulo: string) => {
    const n = r[campo].trim().length;
    if (n === 0) p[campo] = `Escreva ${rotulo}.`;
    else if (n > LIMITE[campo]) p[campo] = `Use até ${conta(LIMITE[campo])} caracteres. Agora são ${conta(n)}.`;
  };
  texto("nome", "um nome");
  texto("descricao", "uma descrição");
  texto("prompt", "o prompt");
  return p;
}

const PRONTO_VAZIO = { enviando: false, problemas: {}, erro: null } as const;

export function formulario(f: Formulario, a: Acao): Formulario {
  // Uma resposta do servidor (carga, gravação ou restauração) vira o novo salvo e limpa o rascunho.
  if (a.tipo === "chegou") return { fase: "pronto", salvo: a.detalhe, rascunho: editavel(a.detalhe), ...PRONTO_VAZIO, descartado: null };
  if (f.fase !== "pronto") return f;
  switch (a.tipo) {
    case "editar": {
      const { [a.campo]: _, ...problemas } = f.problemas;
      return { ...f, rascunho: { ...f.rascunho, [a.campo]: a.valor }, problemas, erro: null, descartado: null };
    }
    case "descartar":
      return sujo(f) ? { ...f, rascunho: editavel(f.salvo), ...PRONTO_VAZIO, descartado: f.rascunho } : f;
    case "recuperar":
      return f.descartado ? { ...f, rascunho: f.descartado, descartado: null } : f;
    case "enviar":
      return { ...f, problemas: a.problemas, erro: null, enviando: Object.keys(a.problemas).length === 0 };
    case "falhou":
      return { ...f, enviando: false, erro: a.erro };
  }
}

/** O que mudou de uma versão para a anterior, em português: "Mudou o prompt e o modelo". */
export function oQueMudou(versao: VersaoBot, anterior: VersaoBot | undefined): string {
  if (!anterior) return "Primeira versão gravada";
  const NOMES: Record<CampoEditavel, string> = { nome: "o nome", descricao: "a descrição", modelo: "o modelo", prompt: "o prompt" };
  const mudou = CAMPOS.filter((c) => versao[c] !== anterior[c]).map((c) => NOMES[c]);
  if (mudou.length === 0) return "Sem mudança";
  return `Mudou ${new Intl.ListFormat("pt-BR", { type: "conjunction" }).format(mudou)}`;
}
