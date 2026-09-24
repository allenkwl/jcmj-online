#!/bin/bash
# MIDI → MP3（不用開 GarageBand）：fluidsynth 用 GeneralUser GS 音色庫演奏，ffmpeg 轉 MP3 並把音量標準化
#
#   bash tools/render-bgm.sh assets/audio/unify-bgm.mid assets/audio/unify-bgm.mp3 24
#                             來源 MIDI                  輸出 MP3                   曲長（秒，最後 1.2 秒淡出）
#
# 音色庫借用小球貓電鐵那一份（沒有的話到 https://schristiansollers.com/generaluser-gs/ 下載）。
# 想要更好的音色：把 MIDI 匯入 GarageBand 換樂器，「分享 → 輸出歌曲到磁碟 → MP3」，檔名蓋掉輸出那一個即可。
set -e
SF="${SF:-$HOME/Documents/DILA/小球貓電鐵/音樂.音效/soundfont/GeneralUser-GS.sf2}"
IN="$1"; OUT="$2"; LEN="${3:-24}"
[ -f "$SF" ] || { echo "找不到音色庫：$SF" >&2; exit 1; }
TMP="$(mktemp -t bgm).wav"
fluidsynth -ni -q -g 0.7 -r 44100 -F "$TMP" "$SF" "$IN"
END=$(python3 -c "print($LEN+1.5)"); FADE=$(python3 -c "print($LEN+0.2)")
ffmpeg -hide_banner -loglevel error -y -i "$TMP" \
  -af "atrim=0:$END,afade=t=out:st=$FADE:d=1.2,loudnorm=I=-16:TP=-1.5:LRA=11" \
  -ar 44100 -codec:a libmp3lame -q:a 3 "$OUT"
rm -f "$TMP"
echo "✓ $OUT"
