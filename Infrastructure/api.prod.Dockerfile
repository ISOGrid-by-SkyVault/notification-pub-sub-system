# Stage 1: Build
FROM node:26-alpine AS builder

WORKDIR /app

# Copy dependency configs
COPY package*.json tsconfig.json ./

# Install all dependencies for compiling
RUN npm ci

# Copy source code and build the project
COPY src/ ./src
RUN npm run build

# Stage 2: Runner
FROM node:26-alpine AS runner

# Install runtime utilities (curl for healthchecks, bash for scripting)
RUN apk add --no-cache bash curl

WORKDIR /app

# Create non-root group and user
RUN addgroup -g 10001 -S appgroup && \
    adduser -u 10001 -S appuser -G appgroup

# Copy compiled files and package settings from builder stage
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/package*.json ./

# Copy the static sender dashboard served by the API at /
COPY --chown=appuser:appgroup client/ ./client

# Install production-only dependencies and clean npm cache to minimize image size
RUN npm ci --omit=dev && npm cache clean --force

# Adjust permissions
RUN chown -R appuser:appgroup /app

# Switch to non-root execution
USER appuser:appgroup

# Environment settings
ENV NODE_ENV=production
EXPOSE 3000

# Start command
CMD ["npm", "run", "start:api"]
