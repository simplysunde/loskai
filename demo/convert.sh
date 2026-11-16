#!/usr/bin/env bash
#
# convert.sh <recordings> <images> <ffmpeg image> — run by scripts/record-demo.sh. Cuts each
# recording to where its flow starts (marks.txt) and writes it into <images> as an animated
# WebP, demo-<flow>.webp. WebP, not GIF: it plays the same everywhere a README is read, at a
# sixth of the size (2026-11-08: 1.8 MB against 250 KB for the Docker flow), and git keeps
# every version of every image.
# ffmpeg runs in its own image, so the host needs nothing but Docker.

set -euo pipefail

# Frames a second, and WebP's quality (0–100). Quality is what the size hangs on: at 70 an
# animation is some 40% smaller than at 80 with its small text as readable, where 8 frames
# a second for 15 saves 15% and makes the cursor jerk (measured 2026-11-16, when these were
# 15 and 80).
FPS=${FPS:-12}
QUALITY=${QUALITY:-70}

src=$(cd "$1" && pwd)
dst=$(mkdir -p "$2" && cd "$2" && pwd)
image=$3

ffmpeg() {
  docker run --rm -q --user "$(id -u):$(id -g)" --entrypoint ffmpeg -v "$src:/in:ro" -v "$dst:/out" "$image" \
    -hide_banner -loglevel error -y "$@"
}

while read -r name start; do
  [ -n "$name" ] || continue
  case $name in
    phone) scale="scale=-2:640:flags=lanczos" ;; # a phone stays a phone, at the height of the rest
    *) scale="scale=960:-2:flags=lanczos" ;;
  esac
  ffmpeg -ss "$start" -i "/in/$name.webm" -vf "fps=$FPS,$scale" \
    -c:v libwebp_anim -lossless 0 -q:v "$QUALITY" -loop 0 "/out/demo-$name.webp"
  printf '  %-16s %5s KB\n' "$name" "$(( $(stat -c %s "$dst/demo-$name.webp") / 1024 ))"
done < "$src/marks.txt"

