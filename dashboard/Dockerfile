# Multi-stage build for production optimization

# Stage 1: Build shared module
FROM node:22.22.3-slim AS shared-builder
WORKDIR /shared
COPY shared/package*.json ./
RUN npm ci --ignore-scripts
COPY shared/ .
RUN npm run build

# Stage 2: Build icons module
FROM node:22.22.3-slim AS icons-builder
WORKDIR /icons
COPY icons/package*.json ./
RUN npm ci --ignore-scripts
COPY icons/ .
RUN npm run build

# Stage 3: Build dashboard
FROM node:22.22.3-slim AS builder

WORKDIR /app

# Copy built shared module
COPY --from=shared-builder /shared ../shared

# Copy built icons module
COPY --from=icons-builder /icons ../icons

# Copy package files and install dependencies
COPY dashboard/package*.json ./
RUN npm ci --ignore-scripts

# Copy backend dependencies for Prisma
# Copy backend dependencies for Prisma
COPY backend/package*.json ../backend/
RUN cd ../backend && npm install prisma

# Copy backend Prisma schema
COPY backend/prisma ../backend/prisma

# Generate Prisma client
RUN cd ../backend && npx prisma generate

# Copy source code LAST to maximize caching
COPY dashboard/ .

# Copy root package.json to / so logger.ts can import version (../../../package.json)
COPY package.json /package.json

# Run validation (TypeScript + ESLint)
RUN npm run validate

# Accept build argument for source commit
ARG SOURCE_COMMIT
ENV REACT_APP_SOURCE_COMMIT=$SOURCE_COMMIT

# Accept build argument for API URL
ENV VITE_API_URL=https://spaces.xyne.juspay.net/api
ENV VITE_ZERO_SERVER=https://spaces.xyne.juspay.net/zero

# Mixpanel token (public client-side analytics; injected at build time)
ARG VITE_MIXPANEL_TOKEN=""
ENV VITE_MIXPANEL_TOKEN=${VITE_MIXPANEL_TOKEN}

# Default workspace ID
ENV VITE_DEFAULT_WORKSPACE_ID=6642623f-cca7-43ad-9a6b-5e49c33226b4

# Build the Vite React app with increased memory
ENV NODE_OPTIONS="--max-old-space-size=8192"
RUN npm run build

# Create ZIP of the built assets for Electron OTA updates
# The ZIP will be served at /releases/dashboard.zip
RUN apt-get update && apt-get install -y zip && \
    mkdir -p /app/releases && \
    cd /app/dist && zip -r ../releases/dashboard.zip .

# Production image with nginx
FROM nginx:alpine AS runner

# Install Node.js and npm for running npm commands in pod
RUN apk add --no-cache nodejs npm

# Create a non-root user
RUN addgroup --system --gid 1001 frontend && \
    adduser --system --uid 1001 frontend

# Copy nginx configuration as template for envsubst
COPY --chown=frontend:frontend dashboard/nginx.conf /etc/nginx/nginx.conf.template

# Copy built assets to nginx html directory (INSTANT permissions)
COPY --from=builder --chown=frontend:frontend /app/dist /usr/share/nginx/html

# Copy releases folder with dashboard.zip for Electron OTA updates
COPY --from=builder --chown=frontend:frontend /app/releases /usr/share/nginx/html/releases

# Set default value for migration flag
ENV ENABLE_MIGRATION=false

# Change ownership of nginx directories (fast)
RUN chown -R frontend:frontend /var/cache/nginx && \
    chown -R frontend:frontend /var/log/nginx && \
    chown -R frontend:frontend /etc/nginx/conf.d && \
    touch /etc/nginx/nginx.conf && \
    chown frontend:frontend /etc/nginx/nginx.conf && \
    touch /var/run/nginx.pid && \
    chown frontend:frontend /var/run/nginx.pid

USER frontend

EXPOSE 8080

# Use envsubst to replace environment variables at runtime
CMD ["/bin/sh", "-c", "envsubst '${ENABLE_MIGRATION}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]
