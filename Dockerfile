FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node server ./server
COPY --chown=node:node public ./public
COPY --chown=node:node content ./content
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node documents ./documents
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
