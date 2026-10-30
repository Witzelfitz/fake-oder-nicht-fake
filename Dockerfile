FROM node:24-alpine
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
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server/index.js"]
