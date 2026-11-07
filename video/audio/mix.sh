#!/usr/bin/env bash
# Mix narration + ducked music + sound effects, normalised to -16 LUFS. Usage: mix.sh voice.wav music.wav sfx.wav out.wav
set -euo pipefail
ffmpeg -y -loglevel error -i "$1" -i "$2" -i "$3" -filter_complex "
[0:a]aresample=48000,pan=stereo|c0=c0|c1=c0,apad,asplit=2[v][vsc];
[1:a]volume=0.09[m];
[m][vsc]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=600[md];
[2:a]volume=1.25[s];
[v][md][s]amix=inputs=3:normalize=0:duration=shortest,loudnorm=I=-14:TP=-1.0:LRA=11,aresample=48000[a]" -map "[a]" -c:a pcm_s16le "$4"
