FROM oven/bun:1.3-slim

# O sharp compõe texto via SVG, e sem fontconfig o resvg cai num fallback que muda
# de execução para execução. Sem isto a mesma entrada devolve bytes diferentes.
RUN apt-get update \
 && apt-get install -y --no-install-recommends fontconfig \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY brand ./brand
COPY styles ./styles

RUN mkdir -p /usr/share/fonts/truetype/emvidros \
 && cp brand/assets/fonts/*.ttf /usr/share/fonts/truetype/emvidros/ \
 && fc-cache -f

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "src/server.ts"]
