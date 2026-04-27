FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package.json ./
COPY shared/pkg/package.json ./shared/pkg/
COPY web/package.json ./web/

# Install from workspace root so @envanter/shared symlink is created
RUN npm install --no-audit --no-fund

# Copy source files
COPY shared/pkg/src/ ./shared/pkg/src/
COPY web/src/ ./web/src/
COPY web/index.html ./web/
COPY web/tsconfig*.json ./web/
COPY web/vite.config.ts ./web/

RUN cd web && npm run build

FROM nginx:alpine
COPY --from=builder /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
