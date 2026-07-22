# Multi-stage build for production optimization
FROM node:22.22.3-slim AS base

WORKDIR /app

# Install build dependencies for native modules and OpenSSL
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    git \
    openssl \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Build the framework first
FROM base AS framework-builder
WORKDIR /framework
COPY framework/package*.json ./
RUN npm ci
COPY framework .
RUN npm run build

# Build the shared module
FROM base AS shared-builder
WORKDIR /shared
COPY shared/package*.json ./
RUN npm ci --ignore-scripts
COPY shared/ .
RUN npm run build

# Build the application
FROM base AS builder
WORKDIR /app
# Copy built shared module
COPY --from=shared-builder /shared ../shared
# Copy package.json but modify it to remove local file dependency
COPY backend/package*.json ./
# Replace local framework dependency with built framework and remove postinstall script
RUN sed -i 's|"agentic-framework": "file:../framework"|"agentic-framework": "file:./framework"|' package.json && \
    sed -i '/"postinstall":/d' package.json
# Copy framework build output 
COPY --from=framework-builder /framework ./framework
# Install ALL dependencies (devDeps needed for prisma generate and tsc build)
# Force include optional deps and install correct platform canvas binaries for Linux
RUN npm install && \
    npm install @napi-rs/canvas-linux-arm64-gnu --save-optional || true && \
    npm install tsconfig-paths && \
    npm install -g @xyne/xyne-cli@latest || echo "xyne-cli installation failed, continuing..." && \
    npm cache clean --force

# Install framework production dependencies
RUN cd framework && npm install --only=production

# Remove existing agentic-framework and create symlink to our built framework
RUN rm -rf /app/node_modules/agentic-framework && \
    ln -sf /app/framework /app/node_modules/agentic-framework
COPY backend .

# Fix TypeScript configuration for Docker build context
# Local paths use ../../framework but Docker uses ../framework
# Also add agentic-framework path mapping for TypeScript to resolve the module
RUN sed -i 's|"../../framework/|"../framework/|g' tsconfig.json && \
    sed -i 's|"../../shared/|"../shared/|g' tsconfig.json && \
    sed -i 's|"@framework": \["../framework/dist"\]|"@framework": ["../framework/dist"],\n      "agentic-framework": ["../framework/dist"]|' tsconfig.json

# Build the application at the bottom
# Add cache-busting argument to ensure db:generate always runs
ARG CACHEBUST=1
RUN npm run db:generate
RUN npm run db:common:generate

# Copy root package.json to / so logger.ts can import version (../../../package.json)
COPY package.json /package.json

RUN npm run build

# Production image
FROM node:22.22.3-slim AS runner
WORKDIR /app

# Install essential tools and OpenSSL
RUN apt-get update && apt-get install -y \
    git \
    curl \
    wget \
    jq \
    openssl \
    openssh-client \
    libssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --create-home --home-dir /home/backend backend

# Copy the source files and dependencies
COPY --from=builder --chown=backend:nodejs /app ./
COPY --from=builder --chown=backend:nodejs /shared ../shared

# Copy root package.json to / so logger.ts can import version (../../../package.json)
COPY package.json /package.json

# Create logs directory and SSH directory
RUN mkdir -p logs && chown backend:nodejs logs && \
    mkdir -p /home/backend/.ssh && \
    chown -R backend:nodejs /home/backend/.ssh && \
    chmod 700 /home/backend/.ssh


# Set bash as default shell for backend user
RUN usermod --shell /bin/bash backend

# Switch to non-root user
USER backend

EXPOSE 3001

ENV NODE_ENV=production

CMD ["npm", "run", "start"]
