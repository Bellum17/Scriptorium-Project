# Utiliser l'image Node.js officielle
FROM node:18-slim

# Installer les dépendances système pour Canvas et les polices
RUN apt-get update && apt-get install -y \
    build-essential \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    libpixman-1-dev \
    pkg-config \
    python3 \
    fontconfig \
    fonts-dejavu-core \
    fonts-liberation \
    && fc-cache -f -v \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers package
COPY package*.json ./

# Installer les dépendances npm
RUN npm ci --only=production

# Copier le reste des fichiers
COPY . .

# Exposer le port (Railway l'utilise automatiquement)
EXPOSE 3000

# Démarrer l'application
CMD ["node", "bot.js"]
