FROM oven/bun:1
WORKDIR /app
COPY railway-function.ts index.ts
EXPOSE 3000
CMD ["bun", "run", "index.ts"]
