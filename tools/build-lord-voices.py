#!/usr/bin/env python3
"""主公的台詞語音（擇國而立按下主公時說一句，v1.89）。

2026-10-23 使用者：「擇國而立時，可以按到哪一個主公就讓他發個聲音嗎？語音能做嗎？」

── 最後的做法（使用者試聽三種後選定）──
  CosyVoice-300M-Instruct（阿里開源 TTS），跑在 H200（allen@172.27.2.139，~/tts，GPU 0，跑完就結束、不常駐）：
    權重  /data/models/CosyVoice/CosyVoice-300M-Instruct（另有 Fun-CosyVoice3-0.5B，比較過、沒採用）
    環境  ~/tts/venv（uv 建的 Python 3.10；套件照 CosyVoice 的 requirements，排除 deepspeed／tensorrt／gradio 等用不到的；
          openai-whisper 要 --no-build-isolation 裝；伺服器沒有 ffmpeg，音訊用 torchaudio 讀）
    程式  tools/voice/gen_lords.py（伺服器上的 ~/tts/gen_lords.py）讀 jobs.json，逐條 inference_instruct → wav
    參數  tools/voice/jobs8.json：每位主公 8 個種子（台詞用**簡體**＋英文角色描述；「商於」的於念 wū，寫成「商乌」）
    篩選  tools/voice/asr8.json：Whisper small 聽寫 → 跟台詞比對拼音（不看聲調）—— 這個模型約三分之一會念壞
  選定：PICK（下面）＝ 使用者聽過的「第三版」。音檔前後靜音修掉、標準化到 -16 LUFS（跟 BGM 同一套 to_mp3）

── 試過、沒採用的 ──
  ‧ Gemini API 語音合成：免費額度每個模型每天只有 10 次；加了語氣指示會連指示一起念出來（一句變 25 秒），
    系統指示欄位這類模型不接受。⚠️ flash-lite 回的是**整個 WAV 檔**、flash 回純 PCM —— 當 PCM 讀會在開頭多一聲「啪」、
    結尾多一段雜音（使用者聽到過）
  ‧ Fun-CosyVoice3：拿 Gemini 七種聲音當參考音色＋中文語氣指示，七人各有音色、念得也比較準；使用者比較後還是選 300M 那版

用法（音檔已經在 assets/audio/voice/，只有要重做時才跑）：
    python3 tools/build-lord-voices.py export     ← 把伺服器 ~/tts/out/ 裡 PICK 那幾條抓回來 → assets/audio/voice/<國>.mp3
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "audio" / "voice"
HOST = "allen@172.27.2.139"

LINES = {   # 遊戲裡的台詞（繁體）；送進模型的是 jobs8.json 裡的簡體
    "qi": "不鳴則已，一鳴驚人！", "chu": "商於六百里，寡人要定了！", "yan": "黃金臺上，待天下賢士！",
    "han": "法令既出，弩箭齊發！", "wei": "何以利吾國？", "zhao": "胡服騎射，天下無敵！", "qin": "六合，必歸於秦。",
}
PICK = {"qi": "qi-s4", "chu": "chu-s5", "yan": "yan-s2", "han": "han-s5", "wei": "wei-s4", "zhao": "zhao-s6", "qin": "qin-s5"}
TRIM = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,"
        "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse")


def export():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from exs_render import to_mp3
    tmp = ROOT / "assets" / "audio" / "試聽" / "voices" / "export"
    tmp.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    for k, i in PICK.items():
        raw = tmp / f"{i}.wav"
        subprocess.run(["scp", "-q", f"{HOST}:~/tts/out/{i}.wav", str(raw)], check=True)
        t = tmp / f"{i}.trim.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-af", TRIM, "-ar", "44100", "-ac", "2", str(t)], check=True)
        to_mp3(t, OUT / f"{k}.mp3", quality=4)
        print(OUT / f"{k}.mp3")


if __name__ == "__main__":
    if (sys.argv[1:] or [""])[0] == "export":
        export()
    else:
        print(__doc__)
