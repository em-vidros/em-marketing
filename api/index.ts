// O build (scripts/build-api.ts) empacota src/server/vercel.ts aqui: o rastreador de dependências
// da Vercel perde pacotes do Bun, então só os módulos nativos ficam de fora do pacote.
export { default } from "./_pacote.js";
