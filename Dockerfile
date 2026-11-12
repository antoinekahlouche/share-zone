FROM oven/bun:1.4.4-alpine
RUN apk add --no-cache zip
WORKDIR /app
COPY package.json server.ts ./
COPY templates ./templates
COPY static ./static
ENV PORT=8080 SHARE_DIR=/data
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 8080
CMD ["bun", "run", "server.ts"]
