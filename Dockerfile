FROM node:24-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS migration
COPY prisma.config.ts ./
COPY prisma ./prisma
RUN npm run db:generate
CMD ["npm", "run", "db:deploy"]

FROM migration AS builder
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 express \
    && mkdir -p /app/storage/uploads \
    && chown -R express:nodejs /app/storage
COPY --from=builder --chown=express:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=express:nodejs /app/dist ./dist
COPY --chown=express:nodejs package.json ./
USER express
EXPOSE 3000
CMD ["node", "dist/server.js"]
