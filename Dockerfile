FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./

RUN npm install && npm cache clean --force

COPY . .

RUN chown -R node:node /app

USER node

CMD ["sh", "-c", "node index.mjs ${DEVICE:-/dev/ttyACM0}"]