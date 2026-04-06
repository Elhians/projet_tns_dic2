"""
TNS Studio — Serveur Flask
ESP/UCAD DIC2 — Traitement Numérique du Signal 2025-2026
Enseignant : Dr. Moustapha MBAYE

Routes :
    GET  /                              → Sert index.html
    POST /api/upload                    → Partie 1 : sauvegarde enregistrement WAV
    POST /api/segment                   → Partie 1 : segmentation par silence
    GET  /api/segments/<filename>       → Partie 1 : lecture/téléchargement d'un segment
    POST /api/analyze                   → Partie 2 : FFT du fichier chargé
    POST /api/filter                    → Partie 2 : filtrage rectangulaire + IFFT
    GET  /api/filtered/<filename>       → Partie 2 : téléchargement du WAV filtré
"""

import os
import io
import re
import uuid

import numpy as np
from scipy.fft import fft, ifft, fftfreq
import scipy.io.wavfile as wavfile
# Résolution ffmpeg/ffprobe sous Windows (dev local).
# Sous Linux/Docker, ffmpeg est installé via apt et disponible dans le PATH.
_FFMPEG_BIN_DIR = r"C:\Users\atk11\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1-full_build\bin"
if os.path.isdir(_FFMPEG_BIN_DIR) and _FFMPEG_BIN_DIR not in os.environ.get("PATH", ""):
    os.environ["PATH"] = _FFMPEG_BIN_DIR + os.pathsep + os.environ.get("PATH", "")

from pydub import AudioSegment

_FFMPEG_EXE  = os.path.join(_FFMPEG_BIN_DIR, "ffmpeg.exe")
_FFPROBE_EXE = os.path.join(_FFMPEG_BIN_DIR, "ffprobe.exe")
if os.path.isfile(_FFMPEG_EXE):
    AudioSegment.converter = _FFMPEG_EXE
if os.path.isfile(_FFPROBE_EXE):
    AudioSegment.ffprobe = _FFPROBE_EXE

from flask import Flask, request, jsonify, send_file, abort
from flask_cors import CORS

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
DB_DIR      = os.path.join(BASE_DIR, "database")   # base de données audio
SEG_DIR     = os.path.join(BASE_DIR, "segments")   # segments extraits
UPLOAD_DIR  = os.path.join(BASE_DIR, "uploads")    # fichiers temporaires Partie 2
FILTERED_DIR = os.path.join(BASE_DIR, "filtered")  # WAV filtrés

ALLOWED_SAMPLE_RATES = {16000, 22050, 44100}
ALLOWED_BIT_DEPTHS   = {16, 32}

# Nombre maximum d'échantillons renvoyés au client pour les graphiques.
# Au-delà, on sous-échantillonne pour ne pas saturer le réseau.
MAX_PLOT_SAMPLES = 8000

app = Flask(__name__, static_folder=BASE_DIR, static_url_path="")
CORS(app)  # Autorise les appels cross-origin (ex. ouverture de index.html en file://)


# ---------------------------------------------------------------------------
# Utilitaires
# ---------------------------------------------------------------------------

def _ensure_dirs():
    """Crée les répertoires de travail s'ils n'existent pas."""
    for d in (DB_DIR, SEG_DIR, UPLOAD_DIR, FILTERED_DIR):
        os.makedirs(d, exist_ok=True)


def _sanitize_name(name: str) -> str:
    """
    Sanitise un nom de dossier (locuteur, session) :
    - Supprime tout caractère non alphanumérique, underscore ou tiret.
    - Interdit les séquences '..' pour éviter les path-traversal.

    Args:
        name: Chaîne brute fournie par le client.

    Returns:
        Chaîne nettoyée, ou 'inconnu' si le résultat est vide.
    """
    cleaned = re.sub(r"[^\w\-]", "_", name.strip())
    cleaned = re.sub(r"\.\.+", "_", cleaned)
    return cleaned if cleaned else "inconnu"


def _next_recording_index(session_dir: str) -> int:
    """
    Calcule le prochain numéro d'enregistrement dans un répertoire de session.

    Args:
        session_dir: Chemin absolu du dossier session.

    Returns:
        Entier représentant le prochain indice (1-based).
    """
    if not os.path.isdir(session_dir):
        return 1
    existing = [
        f for f in os.listdir(session_dir)
        if f.startswith("enreg_") and f.endswith(".wav")
    ]
    return len(existing) + 1


def _normalize_audio(data: np.ndarray) -> np.ndarray:
    """
    Normalise un tableau audio en float32 dans [-1.0, 1.0].

    Args:
        data: Tableau numpy issu de scipy.io.wavfile.read (int16, int32 ou float).

    Returns:
        Tableau float32 normalisé.
    """
    data = data.astype(np.float32)
    if data.dtype != np.float32 or data.max() > 1.0 or data.min() < -1.0:
        max_val = np.iinfo(np.int16).max  # 32767 par défaut
        if data.max() > 1.0:
            max_val = max(abs(data.max()), abs(data.min()), 1.0)
        data = data / max_val
    return np.clip(data, -1.0, 1.0)


def _downsample_for_plot(arr: np.ndarray, max_points: int = MAX_PLOT_SAMPLES) -> list:
    """
    Réduit un tableau numpy à au plus `max_points` points par sous-échantillonnage.

    Args:
        arr:        Tableau numpy 1D.
        max_points: Nombre maximum de points.

    Returns:
        Liste Python de floats.
    """
    if len(arr) <= max_points:
        return arr.tolist()
    step = len(arr) // max_points
    return arr[::step][:max_points].tolist()


def _webm_to_wav(file_stream, sample_rate: int, bit_depth: int) -> bytes:
    """
    Convertit un flux audio (webm/ogg/etc.) en WAV avec les paramètres choisis.

    Args:
        file_stream: Objet fichier-like contenant le flux audio brut.
        sample_rate: Fréquence d'échantillonnage cible (Hz).
        bit_depth:   Profondeur de codage cible (16 ou 32 bits).

    Returns:
        Contenu du fichier WAV en bytes.
    """
    seg = AudioSegment.from_file(file_stream)
    seg = seg.set_channels(1)
    seg = seg.set_frame_rate(sample_rate)
    seg = seg.set_sample_width(bit_depth // 8)

    buf = io.BytesIO()
    seg.export(buf, format="wav")
    return buf.getvalue()


def _any_to_wav_mono(file_stream) -> bytes:
    """
    Convertit un fichier audio quelconque (MP3, OGG, WAV…) en WAV mono.

    Args:
        file_stream: Objet fichier-like.

    Returns:
        Contenu du fichier WAV en bytes.
    """
    seg = AudioSegment.from_file(file_stream)
    seg = seg.set_channels(1)
    buf = io.BytesIO()
    seg.export(buf, format="wav")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    """Sert la page principale (index.html)."""
    return send_file(os.path.join(BASE_DIR, "index.html"))


# ── Partie 1 : Upload ──────────────────────────────────────────────────────

@app.route("/api/upload", methods=["POST"])
def upload():
    """
    Reçoit un enregistrement vocal depuis le navigateur, le convertit
    en WAV avec les paramètres choisis et le sauvegarde dans la base de données.

    FormData attendu :
        audio       : fichier audio (webm/ogg)
        locuteur    : identifiant du locuteur (ex. 'locuteur_01')
        session     : identifiant de la session (ex. 'session_01')
        sample_rate : 16000 | 22050 | 44100
        bit_depth   : 16 | 32

    Returns (JSON) :
        filename : nom du fichier sauvegardé
        path     : chemin relatif dans la base de données
    """
    # --- validation des paramètres ---
    try:
        sample_rate = int(request.form.get("sample_rate", 0))
        bit_depth   = int(request.form.get("bit_depth", 0))
    except ValueError:
        return jsonify({"error": "Paramètres numériques invalides"}), 400

    if sample_rate not in ALLOWED_SAMPLE_RATES:
        return jsonify({
            "error": f"Fréquence invalide : {sample_rate} Hz. "
                     f"Valeurs autorisées : {sorted(ALLOWED_SAMPLE_RATES)}"
        }), 400

    if bit_depth not in ALLOWED_BIT_DEPTHS:
        return jsonify({
            "error": f"Codage invalide : {bit_depth} bits. "
                    f"Valeurs autorisées : {sorted(ALLOWED_BIT_DEPTHS)}"
        }), 400

    if "audio" not in request.files:
        return jsonify({"error": "Fichier audio manquant"}), 400

    # --- sanitisation des noms ---
    locuteur = _sanitize_name(request.form.get("locuteur", "locuteur_01"))
    session  = _sanitize_name(request.form.get("session",  "session_01"))

    # --- répertoire de destination ---
    session_dir = os.path.join(DB_DIR, locuteur, session)
    os.makedirs(session_dir, exist_ok=True)

    # --- numérotation automatique ---
    idx = _next_recording_index(session_dir)

    # Formatage du nom : enreg_001_16kHz_16b.wav
    khz_label = {16000: "16kHz", 22050: "22kHz", 44100: "44kHz"}[sample_rate]
    filename  = f"enreg_{idx:03d}_{khz_label}_{bit_depth}b.wav"
    dest_path = os.path.join(session_dir, filename)

    # --- conversion et sauvegarde ---
    audio_file = request.files["audio"]
    try:
        wav_bytes = _webm_to_wav(audio_file.stream, sample_rate, bit_depth)
    except Exception as e:
        return jsonify({"error": f"Erreur de conversion audio : {str(e)}"}), 500

    with open(dest_path, "wb") as f:
        f.write(wav_bytes)

    relative_path = os.path.join("database", locuteur, session, filename)
    return jsonify({"filename": filename, "path": relative_path})


# ── Partie 1 : Segmentation ────────────────────────────────────────────────

@app.route("/api/segment", methods=["POST"])
def segment():
    """
    Segmente un fichier WAV en détectant les silences.

    JSON attendu :
        filepath        : chemin relatif vers le WAV (issu de /api/upload)
        threshold       : seuil d'amplitude (float, ex. 0.02)
        min_silence_ms  : durée minimale de silence en ms (int, ex. 300)

    Returns (JSON) :
        segments : liste de { name, start, end, duration, url }
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Corps JSON attendu"}), 400

    filepath       = data.get("filepath", "")
    threshold      = float(data.get("threshold", 0.02))
    min_silence_ms = int(data.get("min_silence_ms", 300))

    # --- sécurité : chemin doit être dans BASE_DIR ---
    abs_path = os.path.normpath(os.path.join(BASE_DIR, filepath))
    if not abs_path.startswith(BASE_DIR):
        return jsonify({"error": "Chemin non autorisé"}), 403
    if not os.path.isfile(abs_path):
        return jsonify({"error": "Fichier introuvable"}), 404

    # --- lecture et normalisation ---
    sr, audio = wavfile.read(abs_path)
    if audio.ndim > 1:
        audio = audio[:, 0]   # prendre le premier canal si stéréo
    signal = _normalize_audio(audio)

    # --- détection de segments vocaux ---
    min_silence_samples = int(min_silence_ms * sr / 1000)
    in_voice     = False
    start_sample = 0
    silence_count = 0
    seg_id       = 0
    segs         = []

    for i, amp in enumerate(signal):
        if abs(amp) > threshold:
            if not in_voice:
                in_voice = True
                start_sample = i
            silence_count = 0
        else:
            silence_count += 1
            if in_voice and silence_count >= min_silence_samples:
                end_sample = i - silence_count
                segs.append((start_sample, end_sample, seg_id))
                seg_id  += 1
                in_voice = False

    if in_voice:
        segs.append((start_sample, len(signal) - 1, seg_id))

    # --- extraction et sauvegarde des segments ---
    # Dériver le préfixe depuis le chemin (locuteur + session)
    parts = abs_path.replace("\\", "/").split("/")
    try:
        db_idx  = parts.index("database")
        prefix  = f"{parts[db_idx+1]}_{parts[db_idx+2]}"
    except (ValueError, IndexError):
        prefix = "seg"

    result = []
    for start_s, end_s, sid in segs:
        seg_name = f"{prefix}_seg_{sid+1:03d}.wav"
        seg_path = os.path.join(SEG_DIR, seg_name)

        # Extraire le sous-tableau et sauvegarder
        chunk = signal[start_s:end_s + 1]
        # Reconvertir en int16 pour l'export WAV
        chunk_int = (chunk * 32767).astype(np.int16)
        wavfile.write(seg_path, sr, chunk_int)

        start_s_f = round(start_s / sr, 3)
        end_s_f   = round(end_s   / sr, 3)
        result.append({
            "name"    : seg_name,
            "start"   : start_s_f,
            "end"     : end_s_f,
            "duration": round(end_s_f - start_s_f, 3),
            "url"     : f"/api/segments/{seg_name}",
        })

    return jsonify({"segments": result})


@app.route("/api/segments/<path:filename>")
def serve_segment(filename):
    """
    Sert un fichier WAV de segment pour lecture ou téléchargement.

    Args:
        filename : nom du segment (ex. 'locuteur_01_session_01_seg_001.wav')
    """
    # Empêcher le path traversal
    safe_name = os.path.basename(filename)
    seg_path  = os.path.join(SEG_DIR, safe_name)
    if not os.path.isfile(seg_path):
        abort(404)
    return send_file(seg_path, mimetype="audio/wav", as_attachment=False)


# ── Partie 2 : Analyse FFT ─────────────────────────────────────────────────

@app.route("/api/analyze", methods=["POST"])
def analyze():
    """
    Charge un fichier audio (WAV, MP3, OGG…), le convertit en WAV mono,
    calcule sa FFT et renvoie les données pour affichage.

    FormData attendu :
        audio : fichier audio (tout format supporté par pydub)

    Returns (JSON) :
        serverId    : identifiant unique du fichier (UUID)
        sampleRate  : fréquence d'échantillonnage (Hz)
        duration    : durée en secondes
        timeData    : signal temporel sous-échantillonné (liste)
        frequencies : axe des fréquences (Hz, de 0 à sr/2)
        freqData    : amplitudes spectrales correspondantes
    """
    if "audio" not in request.files:
        return jsonify({"error": "Fichier audio manquant"}), 400

    audio_file = request.files["audio"]
    server_id  = str(uuid.uuid4())
    wav_path   = os.path.join(UPLOAD_DIR, f"{server_id}.wav")

    # --- conversion en WAV mono ---
    try:
        wav_bytes = _any_to_wav_mono(audio_file.stream)
    except Exception as e:
        return jsonify({"error": f"Erreur de conversion : {str(e)}"}), 500

    with open(wav_path, "wb") as f:
        f.write(wav_bytes)

    # --- lecture et normalisation ---
    sr, audio = wavfile.read(wav_path)
    if audio.ndim > 1:
        audio = audio[:, 0]
    signal = _normalize_audio(audio)
    N = len(signal)

    # --- FFT ---
    spectrum    = fft(signal)
    freqs       = fftfreq(N, d=1.0 / sr)
    half        = N // 2
    freq_pos    = freqs[:half].tolist()
    amp_pos     = (np.abs(spectrum[:half]) * 2 / N).tolist()

    return jsonify({
        "serverId"   : server_id,
        "sampleRate" : int(sr),
        "duration"   : round(N / sr, 3),
        "timeData"   : _downsample_for_plot(signal),
        "frequencies": _downsample_for_plot(np.array(freq_pos)),
        "freqData"   : _downsample_for_plot(np.array(amp_pos)),
    })


# ── Partie 2 : Filtrage ────────────────────────────────────────────────────

@app.route("/api/filter", methods=["POST"])
def filter_audio():
    """
    Applique un filtre rectangulaire (passe-bande ou coupe-bande) sur un
    fichier audio préalablement analysé, par masquage dans le domaine fréquentiel.

    Contrainte absolue : H(f) = 1 si fmin ≤ |f| ≤ fmax (passe-bande),
                         H(f) = 1 − H_bp(f)             (coupe-bande).

    JSON attendu :
        serverId   : UUID issu de /api/analyze
        filterType : 'bandpass' | 'bandstop'
        fmin       : borne basse du filtre (Hz)
        fmax       : borne haute du filtre (Hz)

    Returns (JSON) :
        filteredTimeData : signal filtré sous-échantillonné
        filteredFreqData : spectre filtré sous-échantillonné
        audioUrl         : URL de téléchargement du WAV filtré
    """
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Corps JSON attendu"}), 400

    server_id   = data.get("serverId")
    filter_type = data.get("filterType", "bandpass")
    fmin        = float(data.get("fmin", 0))
    fmax        = float(data.get("fmax", 0))

    # --- validation ---
    if not server_id:
        return jsonify({"error": "serverId manquant"}), 400
    if fmin >= fmax:
        return jsonify({"error": "fmin doit être strictement inférieur à fmax"}), 400
    if filter_type not in ("bandpass", "bandstop"):
        return jsonify({"error": "filterType invalide (bandpass | bandstop)"}), 400

    # --- sécurité : UUID pur uniquement ---
    try:
        safe_id = str(uuid.UUID(server_id))
    except ValueError:
        return jsonify({"error": "serverId invalide"}), 400

    wav_path = os.path.join(UPLOAD_DIR, f"{safe_id}.wav")
    if not os.path.isfile(wav_path):
        return jsonify({"error": "Fichier source introuvable. Relancer /api/analyze."}), 404

    # --- lecture et normalisation ---
    sr, audio = wavfile.read(wav_path)
    if audio.ndim > 1:
        audio = audio[:, 0]
    signal = _normalize_audio(audio)
    N = len(signal)

    # --- FFT du signal complet ---
    spectrum = fft(signal)
    freqs    = fftfreq(N, d=1.0 / sr)     # fréquences pour chaque bin (positifs + négatifs)

    # --- construction du masque rectangulaire H(f) ---
    # On travaille sur les fréquences absolues pour traiter les deux moitiés du spectre
    freq_abs = np.abs(freqs)
    H_bp = ((freq_abs >= fmin) & (freq_abs <= fmax)).astype(np.float32)

    if filter_type == "bandpass":
        H = H_bp
    else:
        H = 1.0 - H_bp

    # --- application du masque et IFFT ---
    X_filtered       = spectrum * H
    x_filtered       = np.real(ifft(X_filtered)).astype(np.float32)

    # --- export WAV (int16) ---
    peak = np.max(np.abs(x_filtered))
    if peak > 0:
        x_filtered = x_filtered / peak  # normalisation du pic
    wav_out_name = f"{safe_id}_filtered.wav"
    wav_out_path = os.path.join(FILTERED_DIR, wav_out_name)
    wavfile.write(wav_out_path, sr, (x_filtered * 32767).astype(np.int16))

    # --- données retournées pour affichage ---
    half      = N // 2
    freq_pos  = freqs[:half]
    amp_filt  = np.abs(X_filtered[:half]) * 2 / N

    return jsonify({
        "filteredTimeData": _downsample_for_plot(x_filtered),
        "filteredFreqData": _downsample_for_plot(amp_filt),
        "audioUrl"        : f"/api/filtered/{wav_out_name}",
    })


@app.route("/api/filtered/<path:filename>")
def serve_filtered(filename):
    """
    Sert le fichier WAV filtré pour téléchargement.

    Args:
        filename : nom du fichier filtré (ex. '<uuid>_filtered.wav')
    """
    safe_name   = os.path.basename(filename)
    file_path   = os.path.join(FILTERED_DIR, safe_name)
    if not os.path.isfile(file_path):
        abort(404)
    return send_file(
        file_path,
        mimetype="audio/wav",
        as_attachment=True,
        download_name=safe_name,
    )


# ---------------------------------------------------------------------------
# Point d'entrée
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    _ensure_dirs()
    print("=" * 60)
    print("  TNS Studio — Serveur Flask")
    print("  ESP/UCAD DIC2 — TNS 2025-2026")
    print("  http://localhost:5000")
    print("=" * 60)
    debug_mode = os.environ.get("FLASK_ENV", "development") != "production"
    app.run(host="0.0.0.0", port=5000, debug=debug_mode)
