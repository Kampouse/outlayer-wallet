FROM oven/bun:1
WORKDIR /app
RUN bun add google-auth-library hono@4
COPY railway-function.ts index.ts
EXPOSE 3000
CMD ["bun", "run", "index.ts"]
