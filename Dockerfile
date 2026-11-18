# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY server/package*.json server/
RUN cd server && npm ci
COPY web/package*.json web/
RUN cd web && npm ci
COPY server server
COPY web web
RUN cd web && npm run build && cd ../server && npm run build && npm prune --omit=dev

# ---- run ----
FROM node:22-alpine
ENV NODE_ENV=production PORT=8080 WEB_DIST=/app/web/dist UPLOAD_DIR=/data/uploads TZ=Asia/Kolkata
WORKDIR /app/server
COPY --from=build /app/server/node_modules node_modules
COPY --from=build /app/server/dist dist
COPY --from=build /app/server/migrations migrations
COPY --from=build /app/server/package.json .
COPY --from=build /app/web/dist /app/web/dist
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:8080/api/health || exit 1
CMD ["node", "dist/index.js"]
