# Dockerfile pour NakamaBot avec SQLite
FROM node:18-alpine

# Installer les dépendances système nécessaires pour SQLite
RUN apk add --no-cache \
    sqlite \
    sqlite-dev \
    python3 \
    make \
    g++ \
    gcc \
    libc-dev

# Créer le répertoire de travail
WORKDIR /app

# Copier les fichiers de configuration
COPY package*.json ./

# Installer les dépendances Node.js
RUN npm ci --only=production && npm cache clean --force

# Créer les répertoires nécessaires
RUN mkdir -p temp Cmds

# Copier le code source
COPY . .

# Exposer le port
EXPOSE 5000

# Variables d'environnement par défaut
ENV NODE_ENV=production
ENV PORT=5000

# Commande de démarrage
CMD ["node", "server.js"]
