#!/bin/sh
# Uruchomienie symulatora na Linuksie i macOS (wymaga Pythona 3 i avr-gcc - patrz README)
cd "$(dirname "$0")" || exit 1
exec python3 serwer/serwer.py "$@"
