FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm test
FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=builder --chown=node:node /app /app
USER node
ENV NODE_ENV=production
CMD ["node","server.mjs"]
