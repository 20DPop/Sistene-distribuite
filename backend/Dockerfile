# Dockerfile pentru Backend
FROM node:18-alpine

WORKDIR /app

# Copiază package.json și package-lock.json
COPY package*.json ./

# Instalează dependențele
RUN npm install --production

# Copiază tot codul sursă
COPY . .

# Expune portul
EXPOSE 3001

# Pornește aplicația
CMD ["npm", "start"]