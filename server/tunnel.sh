#!/usr/bin/env bash
# Expose the local Twenty-Nine server to the internet via ngrok.
set -e
PORT="${PORT:-8030}"
if ! command -v ngrok >/dev/null 2>&1; then
  echo "ngrok not installed. Get it at https://ngrok.com/download (or: brew install ngrok)"
  echo "Alternative with no signup:  cloudflared tunnel --url http://localhost:$PORT"
  exit 1
fi
echo "Tunneling http://localhost:$PORT — share the https URL + /online.html"
ngrok http "$PORT"
