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

# Build args (Easypanel los pasa en build). Los mapeamos a ENV en runtime.
ARG PORT=3000
ARG MSSQL_HOST
ARG MSSQL_DB
ARG MSSQL_USER
ARG MSSQL_PASS
ARG MSSQL_PORT=1433
ARG PG_HOST
ARG PG_DB
ARG PG_USER
ARG PG_PASS
ARG PG_PORT=5432

ENV PORT=$PORT \
    MSSQL_HOST=$MSSQL_HOST \
    MSSQL_DB=$MSSQL_DB \
    MSSQL_USER=$MSSQL_USER \
    MSSQL_PASS=$MSSQL_PASS \
    MSSQL_PORT=$MSSQL_PORT \
    PG_HOST=$PG_HOST \
    PG_DB=$PG_DB \
    PG_USER=$PG_USER \
    PG_PASS=$PG_PASS \
    PG_PORT=$PG_PORT

USER node
EXPOSE 3000
CMD ["node", "dist/main.js"] 