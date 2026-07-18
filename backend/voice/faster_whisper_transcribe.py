import json
import os
import sys


DEFAULT_INITIAL_PROMPT = (
    "DOC is a local medical voice assistant. Useful words include fever, cough, "
    "headache, vomiting, diarrhea, chest pain, shortness of breath, swelling, "
    "redness, bruising, bleeding, rash, wound, allergy, medicine, pregnancy, "
    "kidney disease, liver disease, ulcer, blood thinner, generate report. "
    "The user may say short answers such as Rahul, twenty four, no visible "
    "change, no known allergies, or generate report."
)

MODEL_REPOS = {
    "tiny": "Systran/faster-whisper-tiny",
    "tiny.en": "Systran/faster-whisper-tiny.en",
    "base": "Systran/faster-whisper-base",
    "base.en": "Systran/faster-whisper-base.en",
    "small": "Systran/faster-whisper-small",
    "small.en": "Systran/faster-whisper-small.en",
    "medium": "Systran/faster-whisper-medium",
    "medium.en": "Systran/faster-whisper-medium.en",
    "large-v1": "Systran/faster-whisper-large-v1",
    "large-v2": "Systran/faster-whisper-large-v2",
    "large-v3": "Systran/faster-whisper-large-v3",
    "large": "Systran/faster-whisper-large-v3",
}


def json_response(payload):
    print(json.dumps(payload, ensure_ascii=False))


def read_payload():
    raw = sys.stdin.read() or "{}"
    try:
        return json.loads(raw)
    except json.JSONDecodeError as error:
        return {"_payloadError": str(error)}


def get_value(payload, key, env_name, default=""):
    value = payload.get(key)
    if value is None or value == "":
        value = os.environ.get(env_name, default)
    return value


def safe_int(value, default):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def safe_float(value, default):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def cuda_device_count():
    try:
        import ctranslate2

        return int(ctranslate2.get_cuda_device_count())
    except Exception:
        return 0


def huggingface_cache_root():
    if os.environ.get("HF_HUB_CACHE"):
        return os.environ["HF_HUB_CACHE"]
    hf_home = os.environ.get("HF_HOME") or os.path.join(os.path.expanduser("~"), ".cache", "huggingface")
    return os.path.join(hf_home, "hub")


def cached_model_snapshot(model_name):
    model_name = str(model_name or "").strip()
    if not model_name or os.path.isdir(model_name):
        return model_name

    repo_id = MODEL_REPOS.get(model_name.lower())
    if not repo_id:
        return model_name

    repo_cache_dir = os.path.join(huggingface_cache_root(), f"models--{repo_id.replace('/', '--')}", "snapshots")
    if not os.path.isdir(repo_cache_dir):
        return model_name

    snapshots = []
    for item in os.listdir(repo_cache_dir):
        snapshot_path = os.path.join(repo_cache_dir, item)
        if not os.path.isdir(snapshot_path):
            continue
        if os.path.exists(os.path.join(snapshot_path, "model.bin")) and os.path.exists(os.path.join(snapshot_path, "config.json")):
            snapshots.append(snapshot_path)

    if not snapshots:
        return model_name

    return max(snapshots, key=os.path.getmtime)


def resolve_runtime(payload):
    requested_device = str(get_value(payload, "device", "DOC_WHISPER_DEVICE", "auto")).strip().lower()
    if requested_device == "gpu":
        requested_device = "cuda"

    compute_type = str(get_value(payload, "computeType", "DOC_WHISPER_COMPUTE", "")).strip()
    cuda_count = cuda_device_count()

    if requested_device in {"", "auto"}:
        device = "cuda" if cuda_count > 0 else "cpu"
    else:
        device = requested_device

    if not compute_type:
        compute_type = "float16" if device == "cuda" else "int8"

    return {
        "device": device,
        "computeType": compute_type,
        "cudaDeviceCount": cuda_count,
        "requestedDevice": requested_device or "auto",
    }


def import_whisper_model():
    try:
        from faster_whisper import WhisperModel

        return WhisperModel, None
    except Exception as error:
        return None, error


def build_transcribe_options(payload):
    language = get_value(payload, "language", "DOC_WHISPER_LANGUAGE", "en")
    if str(language).strip().lower() in {"", "auto", "detect"}:
        language = None

    initial_prompt = get_value(payload, "initialPrompt", "DOC_WHISPER_INITIAL_PROMPT", DEFAULT_INITIAL_PROMPT)

    return {
        "beam_size": safe_int(payload.get("beamSize") or os.environ.get("DOC_WHISPER_BEAM_SIZE"), 5),
        "vad_filter": True,
        "vad_parameters": {
            "min_silence_duration_ms": safe_int(
                payload.get("minSilenceMs") or os.environ.get("DOC_WHISPER_MIN_SILENCE_MS"),
                500,
            )
        },
        "language": language,
        "initial_prompt": initial_prompt,
        "condition_on_previous_text": False,
        "no_speech_threshold": safe_float(
            payload.get("noSpeechThreshold") or os.environ.get("DOC_WHISPER_NO_SPEECH_THRESHOLD"),
            0.6,
        ),
    }


def load_model(WhisperModel, model_size, runtime):
    return WhisperModel(model_size, device=runtime["device"], compute_type=runtime["computeType"])


def is_model_download_error(error):
    text = str(error).lower()
    return any(
        marker in text
        for marker in [
            "huggingface.co",
            "snapshot_download",
            "certificate_verify_failed",
            "ssl",
            "maxretryerror",
            "connection",
            "repo_info",
        ]
    )


def is_cuda_runtime_error(error):
    text = str(error).lower()
    return any(marker in text for marker in ["cuda", "cublas", "cudnn", "cufft", "curand", "library"])


def model_load_error_payload(error, model_size, runtime, model_reference=""):
    payload = {
        "ok": False,
        "errorCode": "model_load_failed",
        "error": str(error),
        "model": model_size,
        **runtime,
    }
    if model_reference and model_reference != model_size:
        payload["modelPath"] = model_reference
    payload.update(
        {
            "installHint": (
                "The Python package is installed, but the faster-whisper model is not available locally yet. "
                "Run once with internet access so Hugging Face can cache the model, or set DOC_WHISPER_MODEL "
                "to a local CTranslate2 faster-whisper model folder."
            ),
            "sslHint": (
                "If the download fails with CERTIFICATE_VERIFY_FAILED, fix Python/Hugging Face certificate trust "
                "or set REQUESTS_CA_BUNDLE to your network CA certificate file."
            ),
        }
    )
    return {
        **payload,
    }


def transcribe_with_model(model, audio_path, payload):
    segments, info = model.transcribe(audio_path, **build_transcribe_options(payload))
    segment_rows = [
        {
            "start": round(segment.start, 2),
            "end": round(segment.end, 2),
            "text": segment.text.strip(),
        }
        for segment in segments
    ]
    text = " ".join(row["text"] for row in segment_rows).strip()
    return text, segment_rows, info


def main():
    payload = read_payload()
    if payload.get("_payloadError"):
        json_response({"ok": False, "error": "Invalid transcription payload JSON.", "details": payload["_payloadError"]})
        return

    audio_path = payload.get("audioPath")
    if not audio_path or not os.path.exists(audio_path):
        json_response({"ok": False, "error": "Audio file was not found."})
        return

    if os.path.getsize(audio_path) <= 0:
        json_response({"ok": False, "error": "Audio file was empty."})
        return

    WhisperModel, import_error = import_whisper_model()
    if import_error:
        json_response(
            {
                "ok": False,
                "errorCode": "missing_dependency",
                "error": "faster-whisper is not installed in this Python environment.",
                "details": str(import_error),
                "installHint": "Install voice dependencies with: pip install -r requirements.txt",
            }
        )
        return

    model_size = get_value(payload, "model", "DOC_WHISPER_MODEL", "base")
    model_reference = cached_model_snapshot(model_size)
    runtime = resolve_runtime(payload)
    allow_cpu_fallback = payload.get("allowCpuFallback", True) is not False

    try:
        model = load_model(WhisperModel, model_reference, runtime)
    except Exception as error:
        if (
            runtime["device"] == "cuda"
            and runtime["requestedDevice"] in {"", "auto"}
            and allow_cpu_fallback
            and not is_model_download_error(error)
        ):
            fallback_runtime = {**runtime, "device": "cpu", "computeType": "int8", "usedCpuFallback": True}
            try:
                model = load_model(WhisperModel, model_reference, fallback_runtime)
                runtime = fallback_runtime
            except Exception as fallback_error:
                json_response(model_load_error_payload(fallback_error, model_size, fallback_runtime, model_reference))
                return
        else:
            json_response(model_load_error_payload(error, model_size, runtime, model_reference))
            return

    try:
        text, segment_rows, info = transcribe_with_model(model, audio_path, payload)

        json_response(
            {
                "ok": True,
                "text": text,
                "language": getattr(info, "language", ""),
                "languageProbability": getattr(info, "language_probability", 0),
                "duration": getattr(info, "duration", 0),
                "segments": segment_rows,
                "model": model_size,
                "modelPath": model_reference if model_reference != model_size else "",
                **runtime,
            }
        )
    except Exception as error:
        if runtime["device"] == "cuda" and runtime["requestedDevice"] in {"", "auto"} and allow_cpu_fallback and is_cuda_runtime_error(error):
            fallback_runtime = {**runtime, "device": "cpu", "computeType": "int8", "usedCpuFallback": True}
            try:
                model = load_model(WhisperModel, model_reference, fallback_runtime)
                text, segment_rows, info = transcribe_with_model(model, audio_path, payload)
                json_response(
                    {
                        "ok": True,
                        "text": text,
                        "language": getattr(info, "language", ""),
                        "languageProbability": getattr(info, "language_probability", 0),
                        "duration": getattr(info, "duration", 0),
                        "segments": segment_rows,
                        "model": model_size,
                        "modelPath": model_reference if model_reference != model_size else "",
                        "cudaFallbackReason": str(error),
                        **fallback_runtime,
                    }
                )
                return
            except Exception as fallback_error:
                json_response(
                    {
                        "ok": False,
                        "error": str(fallback_error),
                        "cudaFallbackReason": str(error),
                        "model": model_size,
                        "modelPath": model_reference if model_reference != model_size else "",
                        **fallback_runtime,
                    }
                )
                return

        json_response(
            {
                "ok": False,
                "error": str(error),
                "model": model_size,
                "modelPath": model_reference if model_reference != model_size else "",
                **runtime,
            }
        )


if __name__ == "__main__":
    main()
