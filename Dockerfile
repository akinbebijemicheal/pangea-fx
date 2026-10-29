# syntax=docker/dockerfile:1

FROM node:24-alpine AS build
WORKDIR /app
RUN command -v yarn >/dev/null || npm install -g yarn@1.22.22
COPY package.json yarn.lock ./
# One network fetch for everything. The cache mount keeps Yarn's cache across
# builds without baking it into a layer, so rebuilds do not re-download.
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile --ignore-scripts --network-timeout 300000
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN yarn build
# Drop dev dependencies from the packages already in the cache. --offline
# matters: Yarn 1 would otherwise download every devDependency again before
# pruning it.
RUN --mount=type=cache,target=/usr/local/share/.cache/yarn \
    yarn install --frozen-lockfile --ignore-scripts --production --offline

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/main.js"]
