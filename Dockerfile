# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

FROM deps AS builder
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Copiamos deps de producción y artefactos
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY dist ./dist

# Exponer puerto por defecto (se puede sobrescribir con -e PORT=...)
EXPOSE 3000

USER node
CMD ["node", "dist/main.js"] 