# Loft: the relay server plus the web app it serves, in one container.
# Node 24 for the built-in node:sqlite store.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production NETWORK=mainnet DATA_DIR=/data
EXPOSE 8787
CMD ["node", "node_modules/tsx/dist/cli.mjs", "server/index.ts"]
