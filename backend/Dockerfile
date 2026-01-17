# Pasul 1: Folosim o imagine oficială Node.js. 'alpine' este o versiune minimalistă, bună pentru producție.
FROM node:18-alpine

# Pasul 2: Setăm directorul de lucru în interiorul containerului.
WORKDIR /app

# Pasul 3: Copiem fișierele de dependențe. Asteriscul asigură că atât package.json cât și package-lock.json sunt copiate.
COPY package*.json ./

# Pasul 4: Instalăm dependențele proiectului.
# Folosim 'npm ci' (clean install) care este mai rapid și mai sigur pentru build-uri, deoarece folosește strict package-lock.json.
RUN npm ci --only=production

# Pasul 5: Copiem tot restul codului sursă al aplicației în container.
COPY . .

# Pasul 6: Expunem portul pe care aplicația noastră ascultă în interiorul containerului.
# Acesta trebuie să se potrivească cu cel din config.js.
EXPOSE 3001

# Pasul 7: Comanda care va fi executată la pornirea containerului.
CMD [ "node", "server.js" ]