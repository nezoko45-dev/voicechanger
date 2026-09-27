import argparse
import os
import sys
import time

sys.path.insert(0, os.getcwd())
from types import SimpleNamespace

from realtime_vc_engine import RealtimeVCEngine

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--reference", required=True)
    p.add_argument("--input", default="")
    p.add_argument("--output", default="")
    p.add_argument("--fp16", action="store_true", default=True)
    p.add_argument("--gpu", type=int, default=0)
    args = p.parse_args()

    engine_args = SimpleNamespace(
        checkpoint_path=None,
        config_path=None,
        fp16=args.fp16,
        gpu=args.gpu,
    )

    engine = RealtimeVCEngine(engine_args)

    hostapi = next((h for h in engine.hostapis if "WASAPI" in h.upper()), engine.hostapis[0] if engine.hostapis else "")
    input_device = args.input or engine.preferred_device("input")
    output_device = args.output or engine.preferred_device("output")

    engine.set_config(
        reference_audio_path=args.reference,
        sg_hostapi=hostapi,
        sg_input_device=input_device,
        sg_output_device=output_device,
        sr_type="sr_model",
        diffusion_steps=6,
        inference_cfg_rate=0.7,
        max_prompt_length=3.0,
        block_time=0.25,
        crossfade_time=0.05,
        extra_time_ce=2.5,
        extra_time=0.5,
        extra_time_right=0.02,
        function="vc",
    )

    print("Reference:", args.reference)
    print("Host API:", hostapi)
    print("Input:", input_device)
    print("Output:", output_device)
    print("Starting realtime voice conversion...")

    engine.start_stream()
    try:
        while engine.flag_vc:
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        engine.stop_stream()

if __name__ == "__main__":
    main()
