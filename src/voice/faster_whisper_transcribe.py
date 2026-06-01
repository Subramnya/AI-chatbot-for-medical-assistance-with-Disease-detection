import json
import os
import sys


def read_payload():
    return json.loads(sys.stdin.read() or "{}")


def main():
    payload = read_payload()
    audio_path = payload.get("audioPath")
    if not audio_path or not os.path.exists(audio_path):
        print(json.dumps({"ok": False, "error": "Audio file was not found."}))
        return

    try:
        from faster_whisper import WhisperModel
    except Exception as error:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": "faster-whisper is not installed in this Python environment.",
                    "details": str(error),
                    "installHint": "Install with: pip install faster-whisper",
                }
            )
        )
        return

    model_size = payload.get("model") or os.environ.get("DOC_WHISPER_MODEL", "base")
    device = payload.get("device") or os.environ.get("DOC_WHISPER_DEVICE", "cpu")
    compute_type = payload.get("computeType") or os.environ.get("DOC_WHISPER_COMPUTE", "int8")
    language = payload.get("language") or os.environ.get("DOC_WHISPER_LANGUAGE", "en")

    try:
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        segments, info = model.transcribe(
            audio_path,
            beam_size=int(payload.get("beamSize") or 5),
            vad_filter=True,
            language=language or None,
            condition_on_previous_text=False,
        )
        segment_rows = [
            {
                "start": round(segment.start, 2),
                "end": round(segment.end, 2),
                "text": segment.text.strip(),
            }
            for segment in segments
        ]
        print(
            json.dumps(
                {
                    "ok": True,
                    "text": " ".join(row["text"] for row in segment_rows).strip(),
                    "language": getattr(info, "language", ""),
                    "languageProbability": getattr(info, "language_probability", 0),
                    "segments": segment_rows,
                    "model": model_size,
                    "device": device,
                    "computeType": compute_type,
                }
            )
        )
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)}))


if __name__ == "__main__":
    main()
