# Use Node.js LTS version
FROM node:20-slim

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies)
RUN npm install

# Copy TypeScript configuration
COPY tsconfig.json ./

# Copy source code
COPY src/ ./src/
COPY public/ ./public/

# Copy production environment variables
COPY .env.cloudrun .env

# Build TypeScript
RUN npm run build

# Remove dev dependencies
RUN npm ci --only=production

# Create necessary directories
RUN mkdir -p data/transcriptions dist

# Set environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

# Expose port
EXPOSE 8080

# Add health check with longer timeout
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8080/ || exit 1

# Start the application with proper signal handling
CMD ["node", "dist/index.js"] 