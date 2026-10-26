FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN DATABASE_URL="postgresql://hostel:hostel_dev_password@localhost:5432/hostel?schema=public" npm run db:generate
RUN npm run build

EXPOSE 3000
CMD ["node", "dist/src/v1/server.js"]