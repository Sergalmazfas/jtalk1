# Use Node.js LTS version
FROM node:20-slim

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy TypeScript configuration and source code
COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/
COPY credentials/ ./credentials/

# Copy environment variables
COPY .env.production .env

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm ci --only=production

# Create necessary directories
RUN mkdir -p data/transcriptions dist

# Set environment variables
ENV PORT=8080
ENV NODE_ENV=production
ENV HOST=0.0.0.0

# Expose port
EXPOSE 8080

# Add health check with longer timeout
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:8080/ || exit 1

# Start the application with proper signal handling
CMD ["node", "dist/index.js"] 