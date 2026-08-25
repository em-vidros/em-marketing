# O sharp compõe texto via SVG, e sem fontconfig o resvg cai num fallback que muda
# de execução para execução. As fontes já versionadas em brand/assets/fonts entram
# nos dois estágios, então o arnês roda contra o mesmo ambiente que vai a produção.
FROM oven/bun:1.3-slim AS fontes
RUN apt-get update \
 && apt-get install -y --no-install-recommends fontconfig \
 && rm -rf /var/lib/apt/lists/*

# O arnês roda dentro do build: imagem vermelha não existe. O runner do CI não tem
# permissão de `docker run`, só de `docker build`, então o portão mora aqui.
FROM fontes AS verificar
WORKDIR /app
COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile
COPY brand ./brand
RUN mkdir -p /usr/share/fonts/truetype/emvidros \
 && cp brand/assets/fonts/*.ttf /usr/share/fonts/truetype/emvidros/ \
 && fc-cache -f
COPY styles ./styles
COPY src ./src
COPY scripts ./scripts
RUN bun run typecheck && bun run verificar && touch /app/.verificado

FROM fontes
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY brand ./brand
COPY styles ./styles
RUN mkdir -p /usr/share/fonts/truetype/emvidros \
 && cp brand/assets/fonts/*.ttf /usr/share/fonts/truetype/emvidros/ \
 && fc-cache -f
# Amarra o estágio do arnês ao produto: sem ele verde, esta camada não resolve.
COPY --from=verificar /app/.verificado /app/.verificado
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "src/server.ts"]
