import { tokens } from "../brand";
import { validarTextoDaArte, type Problema } from "../brand/validate";
import type { Pilar } from "../art/pipeline";

export type FuncaoDoPlano = keyof typeof tokens.reel.segundosPorFuncao;

export interface Plano {
  funcao: FuncaoDoPlano;
  segundos: number;
  imagem: string;
  textoEmTela?: string;
  fala?: string;
}

export interface Roteiro {
  pilar: Pilar;
  perfil: "produto" | "mini-vlog";
  planos: Plano[];
  tituloDaCapa: string;
}

const fora = (v: number, [min = 0, max = Infinity]: readonly number[]) => v < min || v > max;

/** Confere o roteiro contra o capítulo 14. Ritmo é aviso; capa e texto em tela seguem o checklist. */
export function validarRoteiro(r: Roteiro): Problema[] {
  const out: Problema[] = [];
  const { segundosPorFuncao, segundosPorPilar, capaMaxPalavras } = tokens.reel;

  r.planos.forEach((p, i) => {
    const faixa = segundosPorFuncao[p.funcao];
    if (fora(p.segundos, faixa))
      out.push({ regra: "§14.3 ritmo", severidade: "aviso", detalhe: `plano ${i + 1} (${p.funcao}) tem ${p.segundos} s; a faixa é ${faixa.join(" a ")} s.` });
    if (p.textoEmTela) out.push(...validarTextoDaArte(p.textoEmTela).map((x) => ({ ...x, detalhe: `plano ${i + 1}: ${x.detalhe}` })));
  });

  const total = r.planos.reduce((s, p) => s + p.segundos, 0);
  const alvo = segundosPorPilar[r.pilar];
  if (fora(total, alvo))
    out.push({ regra: "§14.3 duração", severidade: "erro", detalhe: `o reel soma ${total.toFixed(1)} s; ${r.pilar} pede ${alvo.join(" a ")} s.` });

  if (r.tituloDaCapa.split(/\s+/).filter(Boolean).length > capaMaxPalavras)
    out.push({ regra: "§14.9 capa", severidade: "erro", detalhe: `o título da capa passa de ${capaMaxPalavras} palavras.` });

  if (r.perfil === "produto" && r.planos.some((p) => p.fala))
    out.push({ regra: "§14.2 perfil", severidade: "aviso", detalhe: "reel de produto sai mudo; fala pede legenda queimada (§14.7)." });

  return out;
}
