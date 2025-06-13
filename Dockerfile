# Use Node.js 20 LTS
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy root package.json first
COPY package.json ./

# Copy server package files
COPY server/package*.json ./server/

# Install dependencies
RUN npm run install

# Copy all source code
COPY . .

# Build the application
RUN npm run build

# Expose port (Railway will set PORT env var)
EXPOSE 8080

# Start the server
CMD ["npm", "start"]