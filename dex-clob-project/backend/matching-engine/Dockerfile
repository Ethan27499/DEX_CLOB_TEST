# Multi-stage build for Matching Engine
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY matching-engine/package.json matching-engine/package-lock.json ./

# Copy shared directory to correct location for imports
COPY shared ../shared

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY matching-engine .

# Build the application
RUN npm run build

# Copy shared directory to correct location for runtime
RUN cp -r ../shared ./dist/

# Production stage
FROM node:18-alpine AS runtime

WORKDIR /app

# Create logs directory
RUN mkdir -p logs

# Copy built application and dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nextjs -u 1001

# Change ownership
RUN chown -R nextjs:nodejs /app
USER nextjs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

EXPOSE 3001

CMD ["node", "dist/src/index.js"]
