FROM node:22-alpine
# openssl for Prisma; ghostscript to read PDF logo uploads.
RUN apk add --no-cache openssl ghostscript

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .
RUN npm run build

# Railway provides PORT (8080 here); react-router-serve listens on it.
CMD ["npm", "run", "docker-start"]
