# Build stage: compile TypeScript and install production deps.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Runtime stage.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    SQLITE_PATH=/app/data/auction.db
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# Persist the SQLite database outside the container:
#   docker run -v auction-data:/app/data ...
VOLUME ["/app/data"]
CMD ["node", "dist/bot.js"]
