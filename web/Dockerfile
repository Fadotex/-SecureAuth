FROM node:22-alpine

WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
ARG VITE_API_URL=http://127.0.0.1:3001/api/v1
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

EXPOSE 5174
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5174"]