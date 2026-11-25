# FacelessPro Worker - Production Dockerfile
FROM node:22-alpine AS base

# Install dependencies needed for runtime
RUN apk add --no-cache ffmpeg libstdc++ python3 py3-pip

WORKDIR /app

# Copy package files
COPY package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/log/package.json packages/log/
COPY packages/queue/package.json packages/queue/
COPY packages/art/package.json packages/art/
COPY apps/worker/package.json apps/worker/

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
COPY packages/log/src packages/log/src
COPY packages/queue/src packages/queue/src
COPY packages/art/src packages/art/src
# `BUNDLED_CAPTION_FONTS_URL` resolves to `packages/art/fonts/ttf/`
# relative to the package, so the fonts must live there in the image too.
COPY packages/art/fonts packages/art/fonts
COPY apps/worker/src apps/worker/src

# Build TypeScript
RUN npm run build --workspace=@facelesspro/worker

# Production stage
FROM node:22-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache ffmpeg libstdc++ python3 py3-pip

WORKDIR /app

# Copy built artifacts
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages ./packages
COPY --from=base /app/apps/worker ./apps/worker


ENV NODE_ENV=production
ENV DATA_DIR=/data

COPY apps/worker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]