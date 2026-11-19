FROM node:22-alpine

ENV NODE_ENV=production
EXPOSE 8080/tcp
WORKDIR /app

# Build tools for optional native deps (same as upstream scramjet-app)
RUN apk add --upgrade --no-cache python3 make g++

COPY ["package.json", "package-lock.json", "./"]
RUN npm ci --omit=dev --no-audit --no-fund

COPY . .

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
	CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "src/index.js"]
