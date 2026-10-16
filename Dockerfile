FROM node:22-slim

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    DIRETTA_DB=/tmp/diretta.db

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

COPY openapi/ ./openapi/
COPY src/ ./src/

USER node

EXPOSE 8080

CMD ["node", "src/main.ts"]
