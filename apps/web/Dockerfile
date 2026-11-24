# FacelessPro Web - Production Dockerfile
FROM node:22-alpine AS base

WORKDIR /app

# Copy package files
COPY package.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/

# Install all dependencies using npm (more reliable for workspaces in Docker)
RUN npm install --workspaces --include-workspace-root --production=false --ignore-scripts

# Build web app
COPY apps/web/tsconfig.json apps/web/
COPY apps/web/build.mjs apps/web/
COPY packages/contracts/src packages/contracts/src
COPY apps/web/src ./apps/web/src

RUN npm run build --workspace=@facelesspro/web

# Production stage - serve with nginx
FROM nginx:alpine AS production

# Copy built assets
COPY --from=base /app/apps/web/dist /usr/share/nginx/html

# Copy nginx config
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]