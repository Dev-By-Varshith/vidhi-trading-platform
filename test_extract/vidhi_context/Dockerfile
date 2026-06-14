# ── Stage 1: Build Vite app ───────────────────────────────────────────────────
FROM node:22-alpine AS vite-builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --prefer-offline

COPY . .

# Inject API/WS endpoint at build time (for production builds)
ARG VITE_API_URL=http://localhost:8080
ARG VITE_WS_URL=ws://localhost:8080
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

RUN npm run build

# ── Stage 2: Serve with nginx ─────────────────────────────────────────────────
FROM nginx:1.27-alpine

# Copy nginx config with COOP/COEP headers + API proxy + WS proxy
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built Vite assets
COPY --from=vite-builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
