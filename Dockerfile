FROM oven/bun:1.3-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
COPY brand ./brand
COPY styles ./styles
ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "src/server.ts"]
