import { useState } from "react";
import type { Edicao } from "../../../v2/artes";
import type { Ajustes, Camada, Formato } from "../../../v2/camadas";
import { useHistorico } from "./historico";
import * as operacoes from "./operacoes";

export type Painel = "elementos" | "texto" | "uploads" | "camadas" | "cena" | "posicao";

/**
 * O que os controles do editor podem pedir. `campo` junta as edições seguidas do mesmo campo num passo do desfazer;
 * `gesto` identifica um arraste de deslizante, que vira um passo só do aperto ao soltar.
 */
export interface AcoesDoEditor {
  mudar: (camada: Camada, campo?: string, gesto?: string) => void;
  mudarAjustes: (ajustes: Ajustes, campo: keyof Ajustes, gesto?: string) => void;
  acrescentar: (camada: Camada) => void;
  remover: (camada: Camada) => void;
  duplicar: (camada: Camada) => void;
  copiar: (camada: Camada) => void;
  colar: () => boolean;
  empurrar: (camada: Camada, dx: number, dy: number) => void;
  moverNaPilha: (camada: Camada, destino: operacoes.Destino) => void;
  reordenar: (de: number, para: number) => void;
  alinhar: (camada: Camada, caixa: operacoes.Caixa, borda: operacoes.Borda) => void;
  alternarBloqueio: (camada: Camada) => void;
}

/** A camada copiada vale para a sessão inteira, então dá para colar de uma arte na outra, como no Canva. */
let copiada: Camada | null = null;

export function useEditor({ inicial, formato, gravar }: { inicial: Edicao; formato: Formato; gravar: (edicao: Edicao) => void }) {
  const { historico, editar, desfazer, refazer } = useHistorico(inicial, gravar);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const { camadas, ajustes } = historico.presente;
  const camada = camadas.find((c) => c.id === selecionada) ?? null;
  const cheia = camadas.length >= operacoes.MAXIMO_DE_CAMADAS;

  const editarCamadas = (mudanca: (atuais: Camada[]) => Camada[], grupo?: string, gesto?: string) =>
    editar((e) => ({ ...e, camadas: mudanca(e.camadas) }), gesto ? `${grupo}:${gesto}` : grupo, !!gesto);

  function entrar(nova: Camada, mudanca: (atuais: Camada[]) => Camada[]) {
    if (cheia) return;
    editarCamadas(mudanca);
    setSelecionada(nova.id);
  }

  const acoes: AcoesDoEditor = {
    mudar: (nova, campo, gesto) => editarCamadas((atuais) => operacoes.substituir(atuais, nova), campo && `${nova.id}:${campo}`, gesto),
    mudarAjustes: (novos, campo, gesto) => editar((e) => ({ ...e, ajustes: novos }), gesto ? `ajustes:${campo}:${gesto}` : `ajustes:${campo}`, !!gesto),
    acrescentar: (nova) => entrar(nova, (atuais) => operacoes.acrescentar(atuais, nova)),
    remover: (alvo) => {
      if (alvo.bloqueada) return;
      editarCamadas((atuais) => atuais.filter((c) => c.id !== alvo.id));
      setSelecionada(null);
    },
    duplicar: (original) => {
      const copia = operacoes.copiaDe(original, operacoes.novoId());
      entrar(copia, (atuais) => operacoes.duplicar(atuais, copia, original.id));
    },
    copiar: (alvo) => void (copiada = alvo),
    colar: () => {
      if (!copiada || cheia) return false;
      const copia = operacoes.copiaDe(copiada, operacoes.novoId());
      entrar(copia, (atuais) => [...atuais, copia]);

      return true;
    },
    empurrar: (alvo, dx, dy) => {
      if (alvo.bloqueada) return;
      editarCamadas((atuais) => atuais.map((c) => (c.id === alvo.id ? operacoes.empurrar(c, dx, dy) : c)), `${alvo.id}:empurrar`);
    },
    moverNaPilha: (alvo, destino) => editarCamadas((atuais) => operacoes.moverNaPilha(atuais, alvo.id, destino)),
    reordenar: (de, para) => editarCamadas((atuais) => operacoes.reordenar(atuais, de, para)),
    alinhar: (alvo, caixa, borda) => editarCamadas((atuais) => operacoes.substituir(atuais, operacoes.alinharNaPagina(alvo, caixa, formato, borda))),
    alternarBloqueio: (alvo) => editarCamadas((atuais) => operacoes.substituir(atuais, { ...alvo, bloqueada: alvo.bloqueada ? undefined : true })),
  };

  return {
    camadas,
    ajustes,
    camada,
    selecionada,
    selecionar: setSelecionada,
    cheia,
    acoes,
    desfazer,
    refazer,
    podeDesfazer: historico.passado.length > 0,
    podeRefazer: historico.futuro.length > 0,
  };
}
