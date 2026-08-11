FROM node:18-alpine AS dependencies
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci

FROM dependencies AS test
COPY tsconfig.base.json ./
COPY apps/api apps/api
COPY packages/shared packages/shared
COPY prisma prisma

FROM test AS build
RUN npm run prisma:generate && npm run build -w @vigioni/shared && npm run build -w @vigioni/api
RUN npm prune --omit=dev

FROM node:18-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/apps/web/package.json apps/web/package.json
COPY --from=build /app/apps/gateway/package.json apps/gateway/package.json
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/prisma prisma
COPY --from=build /app/node_modules node_modules
USER node
EXPOSE 3000
CMD ["node", "apps/api/dist/index.js"]
