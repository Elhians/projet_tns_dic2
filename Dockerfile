# ── Étape 1 : image de base légère avec Python 3.12 ──────────────────────
FROM python:3.12-slim

# Métadonnées
LABEL maintainer="ESP/UCAD DIC2 — TNS 2025-2026"
LABEL description="TNS Studio — Application Flask de traitement du signal vocal"

# ── Étape 2 : installer ffmpeg (requis par pydub) ─────────────────────────
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── Étape 3 : répertoire de travail ───────────────────────────────────────
WORKDIR /app

# ── Étape 4 : installer les dépendances Python ────────────────────────────
# On copie d'abord requirements.txt seul pour profiter du cache Docker :
# si les dépendances ne changent pas, cette couche n'est pas reconstruite.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ── Étape 5 : copier le code source ───────────────────────────────────────
COPY server.py index.html style.css app.js ./

# ── Étape 6 : créer les dossiers de données ───────────────────────────────
# Ces dossiers seront montés en volumes par docker-compose pour la persistance.
RUN mkdir -p database segments uploads filtered

# ── Étape 7 : exposition du port ──────────────────────────────────────────
EXPOSE 5000

# ── Étape 8 : commande de démarrage ───────────────────────────────────────
# debug=False en production ; 0.0.0.0 pour accepter les connexions hors container.
CMD ["python", "server.py"]
