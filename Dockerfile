FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY src/ ./src/
COPY public/ ./public/

# Default config path (can be overridden with volume mount)
ENV CONFIG_PATH=/app/config.yaml

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "src/server.js"]
