FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY data ./data
COPY tsconfig.json ./
COPY scripts ./scripts
COPY tests ./tests
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && chown node:node /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/data ./data
ENV NODE_ENV=production
USER node
CMD ["npm", "run", "start:prod"]
