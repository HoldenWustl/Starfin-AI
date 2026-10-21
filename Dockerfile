FROM node:24-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends git docker.io && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
ENV NODE_ENV=production
EXPOSE 4000
CMD ["node", "dist/src/index.js"]
