# MINI-PROJET TNS DIC2
## Numérisation, Segmentation et Filtrage d'un Signal Vocal

**École Supérieure Polytechnique (ESP) - UCAD**  
**Département Génie Informatique**  
**DIC 2 - 4ème année - Génie Informatique**  
**Année universitaire : 2025-2026**  
**Enseignant : Dr. Moustapha MBAYE**  

**Étudiants :**  
- Anna NDOYE - DIC 2 SSI  
- El Hadji Ibrahima Niass NDIAYE - DIC 2 Info  

## Lien du dépôt GitHub
- https://github.com/Elhians/projet_tns_dic2.git

## Lien de la vidéo de démonstration (3-5 min)
- A RENSEIGNER ICI : `https://...`

## 1. Introduction
Ce mini-projet a pour objectif de réaliser une application web complète en Python/Flask dédiée au traitement d'un signal vocal.

Le projet est organisé en deux parties complémentaires :
- Partie 1 : numérisation et segmentation automatique d'un signal vocal enregistré depuis le navigateur.
- Partie 2 : analyse fréquentielle par FFT et filtrage rectangulaire (passe-bande ou coupe-bande), puis reconstruction par IFFT.

L'application respecte les contraintes principales du sujet :
- format WAV imposé en sortie,
- filtrage par masque rectangulaire uniquement,
- deux interfaces distinctes (Partie 1 / Partie 2),
- backend Flask.

## 2. Architecture et organisation du code
### 2.1 Structure des fichiers

```text
projet_tns_dic2/
├── server.py          # Backend Flask (API REST, FFT, filtrage, export)
├── index.html         # Interface utilisateur (Partie 1 + Partie 2)
├── app.js             # Logique front-end
├── style.css          # Feuille de style
├── database/          # Base audio organisée par locuteur/session
├── segments/          # Segments vocaux extraits (WAV)
├── uploads/           # Fichiers temporaires d'analyse FFT
├── filtered/          # Fichiers WAV filtrés
├── Dockerfile
├── docker-compose.yml
└── requirements.txt
```

### 2.2 Architecture fonctionnelle
Le front-end JavaScript communique avec Flask par API REST.

| Méthode | Route | Rôle |
|---|---|---|
| POST | `/api/upload` | Sauvegarde d'un enregistrement WAV (Partie 1) |
| POST | `/api/segment` | Segmentation par silence (Partie 1) |
| GET | `/api/segments/<filename>` | Lecture/téléchargement segment |
| POST | `/api/analyze` | Analyse FFT après conversion WAV mono |
| POST | `/api/filter` | Filtrage rectangulaire + IFFT |
| GET | `/api/filtered/<filename>` | Téléchargement WAV filtré |

### 2.3 Bibliothèques utilisées
| Package | Rôle |
|---|---|
| flask | Serveur web et routage |
| flask-cors | Autorisation CORS |
| numpy | Calcul numérique |
| scipy.fft | FFT / IFFT |
| scipy.io.wavfile | Lecture/écriture WAV |
| pydub | Conversion audio via ffmpeg |
| soundfile | I/O audio |
| librosa | Outils audio |

## 3. Partie 1 - Numérisation et segmentation de la voix
### 3.1 Paramètres de numérisation
Conformément au sujet, l'application autorise uniquement :
- Fréquences : 16 kHz, 22.05 kHz, 44.1 kHz
- Codage : 16 bits, 32 bits
- Sortie : WAV
- Durée : libre (en secondes)

Toute valeur non autorisée est rejetée par le backend (HTTP 400).

### 3.2 Justification des paramètres
Selon Shannon-Nyquist, la fréquence d'échantillonnage doit être au moins le double de la fréquence maximale utile du signal. Pour la voix, 16 kHz est le minimum acceptable.

Dans notre implémentation, 44.1 kHz est proposé par défaut pour une meilleure qualité audio et une analyse fréquentielle plus fine.

Le codage 16 bits reste un excellent compromis qualité/taille. Le 32 bits est proposé pour des cas d'analyse nécessitant davantage de précision numérique.

### 3.3 Enregistrement et base locale
L'enregistrement est capturé dans le navigateur via `MediaRecorder`, envoyé au serveur, converti en WAV avec les paramètres choisis, puis sauvegardé dans une arborescence locale structurée :

```text
database/
├── locuteur_01/
│   ├── session_01/
│   │   ├── enreg_001_44kHz_16b.wav
│   │   └── enreg_002_16kHz_32b.wav
│   └── session_02/
└── locuteur_02/
```

### 3.4 Segmentation automatique
La segmentation repose sur :
- seuil d'amplitude,
- durée minimale de silence.

Principe :
1. Normalisation du signal.
2. Détection voix/silence selon le seuil.
3. Fermeture d'un segment quand le silence persiste au-delà de la durée minimale.
4. Export des segments WAV dans `segments/`.

L'interface affiche chaque segment avec lecture et téléchargement.

## 4. Partie 2 - Analyse fréquentielle et filtrage
### 4.1 Chaîne de traitement
1. Chargement d'un fichier audio (WAV/MP3/OGG...).
2. Conversion automatique en WAV mono.
3. Affichage du signal temporel.
4. Calcul FFT + affichage du spectre d'amplitude.
5. Choix utilisateur de `fmin`, `fmax`, type de filtre.
6. Application du masque rectangulaire.
7. Reconstruction par IFFT.
8. Affichage avant/après + écoute + téléchargement du WAV filtré.

### 4.2 Formulation mathématique du filtre rectangulaire
Filtre passe-bande :

`H(f) = 1 si fmin <= |f| <= fmax, sinon 0`

Filtre coupe-bande :

`H_bar(f) = 1 - H(f)`

Application :

`X_filtre(f) = X(f) * H(f)`  
`x_filtre(t) = IFFT(X_filtre(f))`

### 4.3 Choix des bornes fréquentielles
Le choix des bornes se fait visuellement à partir du spectre affiché.

Exemples de réglages :
| Scénario | Type | fmin | fmax | Effet |
|---|---:|---:|---:|---|
| Conserver voix, réduire HF | Passe-bande | 300 | 3400 | Voix plus propre |
| Supprimer ronflement BF | Coupe-bande | 0 | 150 | Réduction fond BF |
| Supprimer secteur 50 Hz | Coupe-bande | 40 | 60 | Réduction bourdonnement |
| Voix large bande | Passe-bande | 80 | 8000 | Restitution plus riche |

## 5. Résultats expérimentaux
### 5.1 Jeux de test
Conformément au sujet, tests sur plusieurs fichiers (au moins 2).

Exemples utilisés :
- Enregistrement vocal direct navigateur (44.1 kHz / 16 bits).
- Enregistrements multi-locuteurs avec pauses marquées.

### 5.2 Observations segmentation
Avec `threshold = 0.02` et `min_silence_ms = 300`, les segments utiles sont bien isolés sur les pauses naturelles de parole.

### 5.3 Observations FFT/filtrage
Le filtrage passe-bande [300, 3400] conserve l'intelligibilité tout en réduisant le bruit hors bande.  
Le coupe-bande [40, 80] atténue efficacement des composantes basses parasites.

## 6. Difficultés rencontrées et solutions
### 6.1 FFmpeg / conversion
Problème : disponibilité ffmpeg variable selon l'environnement.  
Solution : détection robuste (`PATH`, liens Winget, fallback), et installation dans Docker.

### 6.2 Signaux vides/corrompus
Problème : erreurs sur tableau vide.  
Solution : garde-fous côté backend (`N == 0`, HTTP 400).

### 6.3 Cohérence UI téléchargement
Problème : téléchargement activé sans sortie serveur valide.  
Solution : activation uniquement si `audioUrl` renvoyé.

### 6.4 Symétrie spectrale pour IFFT
Problème : masque sur demi-spectre uniquement => reconstruction incohérente.  
Solution : masque sur `|f|` (fréquences positives et négatives).

## 7. Conformité aux exigences du sujet
| Exigence | Statut | Commentaire |
|---|---|---|
| Python 3.x + Flask | Conforme | Respecté |
| Paramètres numérisation imposés | Conforme | Validation backend stricte |
| Format WAV imposé | Conforme | Conversion auto |
| Base `locuteur/session` | Conforme | Arborescence respectée |
| Segmentation auto silence | Conforme | Seuil + durée silence |
| FFT affichée | Conforme | Spectre amplitude affiché |
| Filtre rectangulaire uniquement | Conforme | H(f) binaire |
| IFFT + export WAV filtré | Conforme | Effectif |
| Deux interfaces distinctes | Conforme | Deux panneaux dédiés |
| Docstrings fonctions Python | Conforme | Présentes |

## 8. Tableau de tests reproductible
> A compléter avec vos valeurs exactes si vous refaites une campagne de tests finale.

| ID test | Fichier | Paramètres | Action | Résultat observé |
|---|---|---|---|---|
| T1 | `database/locuteur_01/session_01/enreg_001_44kHz_16b.wav` | seuil=0.02, silence=300ms | Segmentation | Segments séparés correctement, liens lecture/téléchargement OK |
| T2 | `database/locuteur_03/session_01/enreg_002_44kHz_16b.wav` | seuil=0.02, silence=300ms | Segmentation | 2-4 segments selon pauses, cohérents auditivement |
| T3 | `test.mp3` | fmin=300, fmax=3400, passe-bande | Filtrage | Réduction HF, voix intelligible |
| T4 | `test.mp3` | fmin=40, fmax=80, coupe-bande | Filtrage | Atténuation composante basse fréquence |
| T5 | `test.mp3` | fmin>=fmax | Validation | Erreur backend attendue (HTTP 400) |

## 9. Emplacements précis des captures à insérer
Pour faciliter la mise en PDF, insérer les captures aux endroits suivants.

### Capture 1 - Interface Partie 1 (avant enregistrement)
**A placer après la section 3.1**  
Nom conseillé : `capture_01_interface_partie1.png`  
Contenu attendu : sélecteurs fréquence/codage/durée + champs locuteur/session.

### Capture 2 - Enregistrement terminé (forme d'onde)
**A placer après la section 3.3**  
Nom conseillé : `capture_02_waveform_enregistre.png`  
Contenu attendu : forme d'onde temporelle après enregistrement.

### Capture 3 - Résultat de segmentation
**A placer après la section 3.4**  
Nom conseillé : `capture_03_segments.png`  
Contenu attendu : liste des segments avec temps début/fin et boutons lecture/téléchargement.

### Capture 4 - FFT avant filtrage
**A placer dans la section 4.1**  
Nom conseillé : `capture_04_fft_avant.png`  
Légende recommandée : `Spectre avant filtrage - fichier X - paramètres affichage natif`.

### Capture 5 - Paramétrage du filtre
**A placer dans la section 4.3**  
Nom conseillé : `capture_05_param_filtre.png`  
Contenu attendu : `fmin`, `fmax`, type de filtre sélectionné.

### Capture 6 - Comparaison avant/après (signal + FFT)
**A placer dans la section 5.3**  
Nom conseillé : `capture_06_compare_avant_apres.png`  
Légende obligatoire : inclure `fmin=... Hz`, `fmax=... Hz`, type (`passe-bande` ou `coupe-bande`).

### Capture 7 - Lecteur du signal filtré
**A placer après la section 5.3**  
Nom conseillé : `capture_07_lecteur_filtre.png`  
Contenu attendu : lecteur HTML5 du WAV filtré actif + bouton de téléchargement.

## 10. Correction importante intégrée
### Écoute directe du signal filtré
Le lecteur de lecture principal pouvait prêter à confusion car il lisait le signal original.  
Une carte dédiée avec lecteur HTML5 a été ajoutée pour écouter directement le WAV filtré renvoyé par le serveur.

### Incohérence Chart.js corrigée
Le rapport mentionnait Chart.js alors que l'affichage est réalisé par Canvas 2D custom dans `app.js`.  
La formulation correcte est : **visualisation personnalisée sur Canvas HTML5 (sans Chart.js)**.

## 11. Conclusion
Ce mini-projet nous a permis d'appliquer concrètement les notions de TNS : numérisation, segmentation par silence, FFT, filtrage fréquentiel rectangulaire, reconstruction temporelle par IFFT, puis restitution audio.

L'application fonctionne en local, respecte les contraintes du cahier des charges, et constitue une base solide pour des extensions futures (classification de locuteur, traitement adaptatif, etc.).

## 12. Références
- Flask : https://flask.palletsprojects.com
- SciPy FFT : https://docs.scipy.org/doc/scipy/reference/fft.html
- LibROSA : https://librosa.org/doc/latest/index.html
- NumPy : https://numpy.org/doc/stable/
- pydub : https://github.com/jiaaro/pydub
- A. V. Oppenheim & R. W. Schafer, *Discrete-Time Signal Processing*, Pearson, 2010

## 13. Export PDF final propre
Pour générer le livrable PDF final propre :
1. Ouvrir ce README dans VS Code (ou Word via copier/coller formaté).
2. Insérer les captures aux emplacements indiqués en section 9.
3. Mettre le lien vidéo définitif en section "Lien de la vidéo".
4. Exporter en PDF sous le nom : `rapport_TNS_DIC2.pdf`.
