# FacelessPro API - Production Dockerfile
FROM node:22-alpine AS base

# Install dependencies needed for runtime
RUN apk add --no-cache ffmpeg libstdc++

WORKDIR /app

# Copy package files
COPY package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY packages/log/package.json packages/log/
COPY packages/queue/package.json packages/queue/
COPY packages/art/package.json packages/art/
COPY apps/api/package.json apps/api/

# Install dependencies - install each package individually to avoid workspace linking issues
RUN npm install --production=false --ignore-scripts && \
    cd packages/contracts && npm install --production=false --ignore-scripts && cd ../.. && \
    cd packages/core && npm install --production=false --ignore-scripts && cd ../.. && \
    cd packages/db && npm install --production=false --ignore-scripts && cd ../.. && \
    cd packages/log && npm install --production=false --ignore-scripts && cd ../.. && \
    cd packages/queue && npm install --production=false --ignore-scripts && cd ../.. && \
    cd packages/art && npm install --production=false --ignore-scripts && cd ../.. && \
    cd apps/api && npm install --production=false --ignore-scripts && cd ../..

# Copy source files
COPY tsconfig.json ./

# Copy source files
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
COPY apps/api/src apps/api/src

# Build TypeScript
RUN npm run build --workspace=@facelesspro/api

# Production stage
FROM node:22-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache ffmpeg libstdc++

WORKDIR /app

# Copy built artifacts
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages ./packages
COPY --from=base /app/apps/api ./apps/api
COPY --from=base /app/package.json ./


ENV NODE_ENV=production
ENV PORT=3001
ENV DATA_DIR=/data

EXPOSE 3001

COPY apps/api/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]