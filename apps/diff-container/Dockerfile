# Built from the repository root (wrangler `image_build_context: "../.."`) so the workspace
# packages the server imports are available:
#   docker build -f apps/diff-container/Dockerfile .
FROM node:24-slim AS build
WORKDIR /repo
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine packages/engine
COPY packages/shared packages/shared
COPY packages/storage packages/storage
COPY apps/diff-container apps/diff-container
RUN pnpm install --frozen-lockfile --filter diff-container... \
  && pnpm --filter diff-container build

FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
# The bundle has no runtime dependencies left to install.
COPY --from=build /repo/apps/diff-container/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/main.cjs"]
