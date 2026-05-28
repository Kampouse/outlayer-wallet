FROM oven/bun:1

WORKDIR /app

# Install deps
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production

# Copy source
COPY . .

# Build frontend (output to dist/)
RUN bun run build || true

# Expose the port
EXPOSE 3000

# Start the backend
CMD ["bun", "run", "index.ts"]
