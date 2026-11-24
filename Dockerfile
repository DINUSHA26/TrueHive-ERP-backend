# ==========================================
# TrueHive ERP Backend - Multi-Stage Dockerfile
# ==========================================

# 1. Build Stage
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl libc6-compat tzdata
ENV TZ=Asia/Colombo
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install --no-audit --no-fund
COPY . .
RUN npx prisma generate
RUN npm run build

# 2. Production Runner Stage
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl libc6-compat tzdata
ENV TZ=Asia/Colombo
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 4000
CMD ["sh", "-c", "if [ -f dist/main.js ]; then node dist/main.js; else node dist/src/main.js; fi"]
