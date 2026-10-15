FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm test && npm run build
FROM node:22-bookworm-slim AS runner
WORKDIR /app
COPY --from=builder --chown=node:node /app /app
ENV NODE_ENV=production CLINIC_DEMO=0 DEMO_MODE=off
USER node
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
