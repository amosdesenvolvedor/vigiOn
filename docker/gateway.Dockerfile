FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/gateway/package.json apps/gateway/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY apps/gateway apps/gateway
RUN npm run build -w @vigioni/gateway

FROM node:18-alpine
ENV NODE_ENV=production
WORKDIR /agent
RUN apk add --no-cache ffmpeg
COPY --from=build /app/apps/gateway/dist ./dist
USER node
CMD ["node", "dist/index.js"]
