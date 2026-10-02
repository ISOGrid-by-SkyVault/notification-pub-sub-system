FROM node:26-alpine

# Install bash and curl for healthcheck/debugging purposes
RUN apk add --no-cache bash curl

# Create application directory
WORKDIR /app

# Create a non-root group and user with explicit UID/GID for security
RUN addgroup -g 10001 -S appgroup && \
    adduser -u 10001 -S appuser -G appgroup

# Ensure the workdir is owned by our non-root user
RUN chown -R appuser:appgroup /app

# Switch to the non-root user
USER appuser:appgroup

# Copy dependencies manifest
COPY --chown=appuser:appgroup package*.json ./

# Install all dependencies (including devDependencies)
RUN npm ci

# Copy the rest of the codebase (useful for standalone runs, though compose will mount it)
COPY --chown=appuser:appgroup . .

# Expose API port
EXPOSE 3000

# Start with hot reloading script
CMD ["npm", "run", "dev:api"]
