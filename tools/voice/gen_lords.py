# 主公台詞語音（戰國麻將）：讀 jobs.json，逐條用 CosyVoice-300M-Instruct 產生 → out/<id>.wav
import sys, json, os
sys.path.append(os.path.expanduser("~/tts/CosyVoice"))
sys.path.append(os.path.expanduser("~/tts/CosyVoice/third_party/Matcha-TTS"))
import torch, torchaudio
from cosyvoice.cli.cosyvoice import AutoModel
jobs = json.load(open(sys.argv[1]))
out = os.path.expanduser("~/tts/out"); os.makedirs(out, exist_ok=True)
m = AutoModel(model_dir="/data/models/CosyVoice/CosyVoice-300M-Instruct")
for j in jobs:
    torch.manual_seed(j.get("seed", 0))
    parts = [x["tts_speech"] for x in m.inference_instruct(j["text"], j.get("spk", "中文男"), j["instruct"] + "<|endofprompt|>", stream=False, speed=j.get("speed", 1.0))]
    w = torch.cat(parts, dim=1)
    torchaudio.save(os.path.join(out, j["id"] + ".wav"), w, m.sample_rate)
    print(j["id"], round(w.shape[1] / m.sample_rate, 2), "s", flush=True)
