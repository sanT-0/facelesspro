# FacelessPro MCP Server - Production Dockerfile
FROM node:22-alpine AS base

WORKDIR /app

# Copy package files
COPY package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/queue/package.json packages/queue/
COPY apps/mcp/package.json apps/mcp/

# Install all dependencies using npm (more reliable for workspaces in Docker)
RUN npm install --workspaces --include-workspace-root --production=false --ignore-scripts

# Copy source files
COPY tsconfig.json ./

# Copy all source files
COPY packages/contracts/src packages/contracts/src
COPY packages/core/src packages/core/src
COPY packages/core/data packages/core/data
COPY packages/db/src packages/db/src
COPY packages/db/migrations packages/db/migrations
COPY packages/queue/src packages/queue/src
COPY apps/mcp/src apps/mcp/src

# Build TypeScript
RUN npm run build --workspace=@facelesspro/mcp

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Copy built artifacts
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages ./packages
COPY --from=base /app/apps/mcp ./apps/mcp

ENV NODE_ENV=production
ENV PORT=3002

COPY apps/mcp/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]