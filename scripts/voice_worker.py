"""Protocolo JSONL privado: un modelo, una referencia preparada, una petición a la vez."""
import json
import os
import re
import sys
import time
import traceback
from contextlib import redirect_stdout
from pathlib import Path


def emit(payload):
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main():
    # Las librerías pueden imprimir avisos; stdout se reserva al protocolo JSONL.
    with redirect_stdout(sys.stderr):
        import torch
        import torchaudio
        import perth

        # La rueda Windows de Perth no incluye el módulo nativo implícito.
        # Se mantiene la adaptación del motor anterior mediante su fallback oficial.
        if perth.PerthImplicitWatermarker is None:
            print("[compatibilidad] Perth nativo ausente; usando DummyWatermarker de la librería.", file=sys.stderr)
            perth.PerthImplicitWatermarker = perth.DummyWatermarker
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS

        reference = Path(os.environ["MINA_VOICE_REFERENCE"]).resolve(strict=True)
        requested = os.environ.get("VOICE_DEVICE", "cuda")
        if requested == "cuda" and not torch.cuda.is_available():
            raise RuntimeError("CUDA no está disponible. Revisa PyTorch/controlador o usa VOICE_DEVICE=cpu explícitamente.")
        device = "cuda" if requested != "cpu" and torch.cuda.is_available() else "cpu"
        torch.set_num_threads(min(4, os.cpu_count() or 1))
        model = ChatterboxMultilingualTTS.from_pretrained(device=device)
        model.prepare_conditionals(str(reference), exaggeration=0.92)
    emit({"type": "ready", "device": device, "model": "ChatterboxMultilingualTTS", "sample_rate": model.sr})

    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            text = str(request["text"]).strip()
            if not text or len(text) > 1100:
                raise ValueError("El texto está vacío o excede el límite.")
            output = Path(request["out"]).resolve()
            output.parent.mkdir(parents=True, exist_ok=True)
            expressive = bool(re.search(r"[!?¡¿]|\b(?:jaja+|genial|wow)\b", text, re.I))
            started = time.monotonic()
            with redirect_stdout(sys.stderr), torch.inference_mode():
                # Sin audio_prompt_path: reutiliza el condicionamiento de voz ya calculado.
                wav = model.generate(
                    text, "es", exaggeration=0.95 if expressive else 0.92,
                    repetition_penalty=1.18 if expressive else 1.22,
                    min_p=0.01 if expressive else 0.02,
                    top_p=0.91 if expressive else 0.93,
                    cfg_weight=0.72 if expressive else 0.58,
                    temperature=0.98 if expressive else 0.95,
                )
                torchaudio.save(str(output), wav, model.sr)
            emit({"type": "done", "id": request["id"], "out": str(output),
                  "elapsed_ms": round((time.monotonic() - started) * 1000)})
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            emit({"type": "error", "id": request.get("id"), "error": str(error)})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        emit({"type": "fatal", "error": str(error)})
        sys.exit(1)
