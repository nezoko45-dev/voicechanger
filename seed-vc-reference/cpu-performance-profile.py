"""Apply conservative CPU settings while preserving saved audio-device choices."""
import json
from pathlib import Path

root = Path(__file__).resolve().parent
engine = root / "engine"
config_dir = engine / "configs" / "inuse"
config_path = config_dir / "config.json"
default_path = engine / "configs" / "config.json"

if config_path.exists():
    data = json.loads(config_path.read_text(encoding="utf-8"))
elif default_path.exists():
    data = json.loads(default_path.read_text(encoding="utf-8"))
else:
    data = {}

# Keep the user's selected input/output devices, reference path, and sample-rate
# preference. Reduce the expensive inference settings for CPU-only machines.
data.update({
    "diffusion_steps": 1,
    "inference_cfg_rate": 0.0,
    "max_prompt_length": 1.0,
    "block_time": 1.5,
    "crossfade_length": 0.04,
    "extra_time_ce": 1.0,
    "extra_time": 0.5,
    "extra_time_right": 0.02,
})
config_dir.mkdir(parents=True, exist_ok=True)
config_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
print("Applied CPU-friendly profile:")
print("  Diffusion steps: 1")
print("  Inference CFG: 0.0 (faster)")
print("  Max prompt length: 1.0 s")
print("  Block time: 1.5 s (more processing headroom, higher latency)")
print("  Extra right context: 0.02 s")
