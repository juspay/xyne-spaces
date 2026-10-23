#!/bin/sh
set -e

# A virtual screen for headed Chrome: Meet and Google sign-in refuse headless Chrome.
export DISPLAY="${DISPLAY:-:99}"
rm -f "/tmp/.X${DISPLAY#:}-lock"
Xvfb "$DISPLAY" -screen 0 1280x720x24 -nolisten tcp >/dev/null 2>&1 &
for _ in $(seq 1 50); do
  [ -e "/tmp/.X11-unix/X${DISPLAY#:}" ] && break
  sleep 0.1
done

# Chrome needs an audio output device to decode the meeting's audio: a PulseAudio
# null sink gives it one without any hardware.
pulseaudio --daemonize=yes --exit-idle-time=-1 --log-target=stderr
pactl load-module module-null-sink sink_name=meetbot >/dev/null
pactl set-default-sink meetbot

exec "$@"
