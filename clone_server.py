import os
from pathlib import Path
from flask import Flask, request, jsonify

app = Flask(__name__)
ROOT = Path(__file__).resolve().parent
OUT = ROOT / "cloned_voice"
OUT.mkdir(exist_ok=True)

_converter = None
_device = None

def get_converter():
    global _converter, _device
    if _converter is not None:
        return _converter
    import torch
    from openvoice.api import ToneColorConverter
    ckpt = ROOT / "checkpoints_v2" / "converter"
    config = ckpt / "config.json"
    weights = ckpt / "checkpoint.pth"
    if not config.exists() or not weights.exists():
        raise RuntimeError("OpenVoice V2 converter checkpoint is missing. Put checkpoints_v2/converter/config.json and checkpoint.pth in this app.")
    _device = "cuda:0" if torch.cuda.is_available() else "cpu"
    _converter = ToneColorConverter(str(config), device=_device)
    _converter.load_ckpt(str(weights))
    return _converter

@app.after_request
def cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

@app.get("/health")
def health():
    return jsonify(ok=True, service="openvoice-clone")

@app.route("/clone", methods=["POST","OPTIONS"])
def clone():
    if request.method == "OPTIONS":
        return ("", 204)
    try:
        if "reference" not in request.files:
            return jsonify(ok=False, error="No reference WAV was uploaded."), 400
        ref = request.files["reference"]
        if not ref.filename:
            return jsonify(ok=False, error="Reference filename is empty."), 400
        if not ref.filename.lower().endswith(".wav"):
            return jsonify(ok=False, error="Please use a WAV reference file."), 400

        source = OUT / "reference.wav"
        ref.save(source)

        from openvoice import se_extractor
        converter = get_converter()
        target_se, _ = se_extractor.get_se(
            str(source),
            converter,
            target_dir=str(OUT / "processed"),
            vad=True,
        )
        target_se_path = OUT / "voice_embedding.pth"
        import torch
        torch.save(target_se.detach().cpu(), target_se_path)

        return jsonify(
            ok=True,
            file=str(target_se_path.name),
            device=_device,
            message="OpenVoice voice embedding created successfully."
        )
    except Exception as exc:
        return jsonify(ok=False, error=str(exc)), 500

if __name__ == "__main__":
    print("OpenVoice clone service: http://127.0.0.1:8000")
    print("Waiting for a reference WAV...")
    app.run(host="127.0.0.1", port=8000, debug=False)
