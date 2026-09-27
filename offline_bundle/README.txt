OFFLINE BUNDLE

Put the pre-downloaded runtime files here before running setup_local.bat:

offline_bundle\
  node_modules\
    sherpa-onnx-node\
    ws\
  models\
    sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20\
    sherpa-onnx-pocket-tts-int8-2026-01-26\

setup_local.bat copies these folders into the project.

IMPORTANT:
- Do not put archive URLs or installers here.
- Node.js itself must already be installed on Windows.
- setup_local.bat never downloads or installs anything.
- The repository does not currently contain the large binary bundle; populate this folder on an Internet-connected machine once, then copy the complete folder to the offline machine.
