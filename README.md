# TNS Studio — Numérisation, Segmentation et Filtrage Vocal

**ESP/UCAD — DIC 2 (4ème année) — Traitement Numérique du Signal 2025-2026**  
Enseignant : Dr. Moustapha MBAYE | Travail en binôme

Application web Python/Flask permettant :
- **Partie 1** : Enregistrement vocal configurable, sauvegarde WAV structurée, segmentation automatique par silence
- **Partie 2** : Analyse FFT d'un fichier audio, filtrage rectangulaire (passe-bande / coupe-bande), reconstruction par IFFT

---

## Prérequis

### Exécution locale (venv)
- Python 3.10+
- [ffmpeg](https://ffmpeg.org/) installé et accessible dans le PATH  
  *Sur Windows avec winget :* `winget install --id Gyan.FFmpeg -e`

### Exécution Docker
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (inclut Docker Compose)

---

## Installation et lancement

### Option A — Environnement virtuel (venv)

```bash
# 1. Créer et activer le virtualenv
python -m venv venv

# Windows (PowerShell)
.\venv\Scripts\activate

# Linux / macOS
source venv/bin/activate

# 2. Installer les dépendances
pip install -r requirements.txt

# 3. Lancer le serveur
python server.py
```

Ouvrir ensuite **http://localhost:5000** dans le navigateur.

> **Note Windows** : si ffmpeg est installé via winget mais n'est pas dans le PATH système,
> `server.py` l'injecte automatiquement depuis  
> `C:\Users\<user>\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_...\bin`.  
> Adaptez `_FFMPEG_BIN_DIR` dans `server.py` si votre chemin d'installation diffère.

---

### Option B — Docker (recommandé pour déploiement)

```bash
# Construire l'image et démarrer le conteneur
docker compose up --build

# En arrière-plan
docker compose up --build -d

# Arrêter
docker compose down
```

Ouvrir ensuite **http://localhost:5000** dans le navigateur.

ffmpeg est installé automatiquement dans l'image (`apt install ffmpeg`).  
Les données audio sont persistées via des **bind mounts** sur la machine hôte :

| Volume Docker | Dossier hôte |
|---------------|--------------|
| `/app/database` | `./database` |
| `/app/segments` | `./segments` |
| `/app/uploads` | `./uploads` |
| `/app/filtered` | `./filtered` |

---

## Structure du projet

```
.
├── server.py           # Serveur Flask (API + fichiers statiques)
├── index.html          # Interface web
├── style.css           # Feuille de style (thème sombre cyberpunk)
├── app.js              # Logique frontend (enregistrement, FFT, visualisations)
├── requirements.txt    # Dépendances Python
├── Dockerfile          # Image Docker (python:3.12-slim + ffmpeg)
├── docker-compose.yml  # Orchestration Docker avec bind mounts
├── .dockerignore       # Exclusions Docker (venv, data, pdf, .git)
├── README.md           # Ce fichier
│
├── database/           # Base de données audio (Partie 1, créé automatiquement)
│   └── locuteur_01/
│       └── session_01/
│           ├── enreg_001_16kHz_16b.wav
│           └── enreg_002_44kHz_32b.wav
│
├── segments/           # Segments vocaux extraits (créé automatiquement)
├── uploads/            # Fichiers temporaires pour l'analyse FFT (créé automatiquement)
└── filtered/           # WAV filtrés en sortie (créé automatiquement)
```

---

## API Flask

### Partie 1 — Numérisation & Segmentation

| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/api/upload` | Reçoit le blob audio (webm), le convertit en WAV avec les paramètres choisis et le sauvegarde dans `database/` |
| `POST` | `/api/segment` | Charge un WAV sauvegardé, détecte les silences et découpe en segments dans `segments/` |
| `GET`  | `/api/segments/<filename>` | Sert un segment WAV pour lecture ou téléchargement |

**Paramètres de `/api/upload` (FormData) :**

| Champ | Valeurs autorisées |
|-------|--------------------|
| `sample_rate` | `16000`, `22050`, `44100` |
| `bit_depth` | `16`, `32` |
| `locuteur` | Chaîne alphanumérique (ex. `locuteur_01`) |
| `session` | Chaîne alphanumérique (ex. `session_01`) |

Toute valeur hors du tableau renvoie une erreur **400**.

**Paramètres de `/api/segment` (JSON) :**

```json
{
  "filepath": "database/locuteur_01/session_01/enreg_001_16kHz_16b.wav",
  "threshold": 0.02,
  "min_silence_ms": 300
}
```

---

### Partie 2 — Analyse FFT & Filtrage

| Méthode | Route | Description |
|---------|-------|-------------|
| `POST` | `/api/analyze` | Reçoit un fichier audio (WAV/MP3/OGG), calcule la FFT et retourne les données pour affichage |
| `POST` | `/api/filter` | Applique le masque rectangulaire sur le spectre + IFFT, sauvegarde et retourne le WAV filtré |
| `GET`  | `/api/filtered/<filename>` | Téléchargement du WAV filtré |

**Paramètres de `/api/filter` (JSON) :**

```json
{
  "serverId": "<uuid retourné par /api/analyze>",
  "filterType": "bandpass",
  "fmin": 300,
  "fmax": 3000
}
```

**Formule du masque (conforme sujet) :**

$$H(f) = \begin{cases} 1 & \text{si } f_{min} \leq |f| \leq f_{max} \quad \text{(passe-bande)} \\ 0 & \text{sinon} \end{cases}$$

$$\bar{H}(f) = 1 - H(f) \quad \text{(coupe-bande)}$$

---

## Dépendances Python

| Package | Rôle |
|---------|------|
| `flask` | Serveur web et routage |
| `flask-cors` | Headers CORS (`Access-Control-Allow-Origin: *`) |
| `numpy` | Calculs numériques |
| `scipy` | FFT (`scipy.fft`), lecture WAV (`scipy.io.wavfile`) |
| `pydub` | Conversion de formats audio (nécessite ffmpeg) |
| `soundfile` | Lecture/écriture audio haute qualité |
| `librosa` | Analyse audio avancée |
| `werkzeug` | Utilitaires Flask |

---

## Contraintes techniques respectées

- Langage : **Python 3.x** uniquement
- Framework web : **Flask** uniquement
- Format audio : **WAV** imposé (conversion automatique via pydub)
- Filtrage : **masque rectangulaire uniquement** (passe-bande ou coupe-bande)
- Deux interfaces distinctes (Partie 1 et Partie 2)
- Chaque fonction Python est documentée par une **docstring**
- CORS activé pour permettre l'accès depuis `file://` et `http://localhost`
- Déployable sous Linux/Docker sans modification (ffmpeg via apt)

---

## Références

- Flask : https://flask.palletsprojects.com
- SciPy FFT : https://docs.scipy.org/doc/scipy/reference/fft.html
- LibROSA : https://librosa.org/doc/latest/index.html
- A. V. Oppenheim & R. W. Schafer, *Discrete-Time Signal Processing*, Pearson, 2010
