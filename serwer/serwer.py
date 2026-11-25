#!/usr/bin/env python3
# Serwer symulatora ATtiny24 - wersja w Pythonie (Linux, macOS, także Windows)
# - udostępnia aplikację (folder "aplikacja") pod adresem http://localhost:PORT/
# - kompiluje programy kompilatorem avr-gcc tymi samymi flagami co serwer.ps1 i PlatformIO
#
# Kompilator jest szukany po kolei w:
#   1. zmiennej środowiskowej AVR_GCC_BIN (folder z avr-gcc),
#   2. folderze kompilator/bin (dołączony avr-gcc dla Windows),
#   3. ~/.platformio/packages/toolchain-atmelavr/bin (avr-gcc 7.3.0 z PlatformIO - zalecany),
#   4. ścieżce PATH (np. avr-gcc z apt / brew).
# Biblioteka Arduino w folderze arduino/ jest skompilowana avr-gcc 7.3.0 z LTO - programy
# z Arduino.h wymagają tej samej wersji kompilatora. BASCOM i własne main() działają z każdą.
#
# Uruchomienie: python3 serwer/serwer.py [--port 8024] [--no-browser]

import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
APP = BASE / 'aplikacja'
ARD = BASE / 'arduino'
WIN = os.name == 'nt'

MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.cpp': 'text/plain; charset=utf-8', '.bas': 'text/plain; charset=utf-8',
}


def find_toolchain():
    exe = 'avr-gcc.exe' if WIN else 'avr-gcc'
    candidates = []
    if os.environ.get('AVR_GCC_BIN'):
        candidates.append(Path(os.environ['AVR_GCC_BIN']))
    if WIN:
        candidates.append(BASE / 'kompilator' / 'bin')
    candidates.append(Path.home() / '.platformio' / 'packages' / 'toolchain-atmelavr' / 'bin')
    for d in candidates:
        if (d / exe).is_file():
            return d
    found = shutil.which('avr-gcc')
    return Path(found).parent if found else None


BIN = find_toolchain()


def tool(name):
    return str(BIN / (name + ('.exe' if WIN else '')))


def gcc_version():
    try:
        return subprocess.run([tool('avr-gcc'), '-dumpversion'], capture_output=True, text=True, timeout=20).stdout.strip()
    except Exception:
        return ''


def run_tool(name, argv, cwd):
    p = subprocess.run([tool(name)] + argv, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    return {'code': p.returncode, 'out': p.stdout, 'err': p.stderr, 'cmd': ' '.join([name] + argv)}


def compile_program(req):
    res = {'ok': False, 'steps': [], 'hex': '', 'eep': '', 'size': '', 'nm': '', 'lines': '', 'lst': ''}
    if BIN is None:
        res['steps'].append({'name': 'kompilacja', 'code': 1, 'cmd': 'avr-gcc',
                             'out': 'Nie znaleziono kompilatora avr-gcc. Zainstaluj go (np. PlatformIO albo apt install gcc-avr avr-libc) '
                                    'albo podaj folder w zmiennej AVR_GCC_BIN.\n'})
        return res
    fcpu = str(req.get('fcpu') or '8000000')
    mode = str(req.get('mode') or '')
    common = ['-mmcu=attiny24', '-Os', '-Wall', '-ffunction-sections', '-fdata-sections', '-g']
    cxx = ['-fno-exceptions', '-fno-threadsafe-statics', '-fpermissive', '-std=gnu++11', '-flto']
    work = tempfile.mkdtemp(prefix='symulator-attiny24-')
    try:
        def write(name, text):
            Path(work, name).write_text(str(text or ''), encoding='utf-8')

        if mode == 'basic':
            write('program.bas', req.get('source'))
            write('program.c', req.get('csource'))
            c = ['-c'] + common + ['-std=gnu11', '-Wno-unused-label', '-Wno-unused-variable', '-Wno-unused-but-set-variable',
                                   f'-DF_CPU={fcpu}UL', 'program.c', '-o', 'program.o']
            l = ['-g', '-mmcu=attiny24', '-Os', '-Wl,--gc-sections', '-o', 'firmware.elf', 'program.o', '-lm']
            gcc = 'avr-gcc'
        elif mode == 'cpp':
            write('main.cpp', req.get('source'))
            c = ['-c'] + cxx + common + [f'-DF_CPU={fcpu}L', 'main.cpp', '-o', 'main.o']
            l = ['-g', '-mmcu=attiny24', '-Os', '-Wl,--gc-sections', '-flto', '-fuse-linker-plugin', '-o', 'firmware.elf', 'main.o', '-lm']
            gcc = 'avr-g++'
        else:
            write('main.cpp', req.get('source'))
            c = ['-c'] + cxx + common + ['-DPLATFORMIO=60200', '-DARDUINO_AVR_ATTINYX4', f'-DF_CPU={fcpu}L', '-DARDUINO_ARCH_AVR',
                                         '-DARDUINO=10808', '-DCLOCK_SOURCE=0', '-DNEOPIXELPORT=PORTA',
                                         '-I' + str(ARD / 'core'), '-I' + str(ARD / 'variant'), 'main.cpp', '-o', 'main.o']
            l = ['-g', '-mmcu=attiny24', '-Os', '-Wl,--gc-sections', '-flto', '-fuse-linker-plugin', '-o', 'firmware.elf', 'main.o',
                 '-L' + str(ARD), '-Wl,--start-group', '-lFrameworkArduino', '-lm', '-Wl,--end-group']
            gcc = 'avr-g++'

        for name, argv in (('kompilacja', c), ('linkowanie', l)):
            r = run_tool(gcc, argv, work)
            res['steps'].append({'name': name, 'code': r['code'], 'out': r['out'] + r['err'], 'cmd': r['cmd']})
            if r['code'] != 0:
                return res

        elf_outputs(res, work)
        return res
    finally:
        shutil.rmtree(work, ignore_errors=True)


# hex, eep, rozmiary, symbole, tablica linii i listing z firmware.elf w folderze work
def elf_outputs(res, work):
    run_tool('avr-objcopy', ['-O', 'ihex', '-R', '.eeprom', 'firmware.elf', 'firmware.hex'], work)
    run_tool('avr-objcopy', ['-O', 'ihex', '-j', '.eeprom', '--set-section-flags=.eeprom=alloc,load', '--no-change-warnings',
                             '--change-section-lma', '.eeprom=0', 'firmware.elf', 'firmware.eep'], work)
    res['hex'] = Path(work, 'firmware.hex').read_text(encoding='utf-8')
    eep = Path(work, 'firmware.eep')
    if eep.is_file():
        res['eep'] = eep.read_text(encoding='utf-8')
    res['size'] = run_tool('avr-size', ['-A', 'firmware.elf'], work)['out']
    res['nm'] = run_tool('avr-nm', ['-S', '-n', '-C', 'firmware.elf'], work)['out']
    res['lines'] = run_tool('avr-objdump', ['--dwarf=decodedline', 'firmware.elf'], work)['out']
    res['lst'] = run_tool('avr-objdump', ['-d', '-S', '-C', 'firmware.elf'], work)['out']
    res['ok'] = True


# gotowy plik z zewnątrz (PlatformIO, BASCOM): kind = 'elf' albo 'hex', data = base64
def analyze_file(req):
    res = {'ok': False, 'hex': '', 'eep': '', 'size': '', 'nm': '', 'lines': '', 'lst': ''}
    if BIN is None:
        res['error'] = 'brak avr-gcc'
        return res
    work = tempfile.mkdtemp(prefix='symulator-attiny24-')
    try:
        data = base64.b64decode(req.get('data') or '')
        if req.get('kind') == 'elf':
            Path(work, 'firmware.elf').write_bytes(data)
            elf_outputs(res, work)
        else:
            Path(work, 'firmware.hex').write_bytes(data)
            res['hex'] = data.decode('ascii', errors='replace')
            res['lst'] = run_tool('avr-objdump', ['-D', '-m', 'avr25', '-b', 'ihex', 'firmware.hex'], work)['out']
            res['ok'] = True
        return res
    finally:
        shutil.rmtree(work, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    server_version = 'SymulatorATtiny24'

    def log_message(self, fmt, *args):
        pass                                    # bez logu każdego pliku

    def send(self, status, ctype, data):
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def send_json(self, obj):
        self.send(200, 'application/json; charset=utf-8', json.dumps(obj).encode('utf-8'))

    def do_GET(self):
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        if path == '/api/ping':
            self.send_json({'ok': BIN is not None, 'kompilator': 'avr-gcc ' + VERSION, 'port': self.server.server_port})
            return
        rel = path.lstrip('/') or 'index.html'
        full = (APP / rel).resolve()
        if APP not in full.parents and full != APP or not full.is_file():
            self.send(404, 'text/plain; charset=utf-8', b'404')
            return
        self.send(200, MIME.get(full.suffix.lower(), 'application/octet-stream'), full.read_bytes())

    def do_POST(self):
        if self.path not in ('/api/compile', '/api/analyze'):
            self.send(404, 'text/plain; charset=utf-8', b'404')
            return
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))).decode('utf-8'))
        if self.path == '/api/analyze':
            self.send_json(analyze_file(body))
            return
        t0 = time.time()
        res = compile_program(body)
        res['ms'] = int((time.time() - t0) * 1000)
        print(f"  [{time.strftime('%H:%M:%S')}] kompilacja ({body.get('mode')}) - {'OK' if res['ok'] else 'blad'}, {res['ms']} ms", flush=True)
        self.send_json(res)


VERSION = gcc_version() if BIN else ''


def main():
    ap = argparse.ArgumentParser(description='Serwer symulatora ATtiny24')
    ap.add_argument('--port', type=int, default=8024)
    ap.add_argument('--no-browser', action='store_true')
    args = ap.parse_args()

    server = None
    for port in range(args.port, args.port + 20):
        try:
            server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
            break
        except OSError:
            continue
    if server is None:
        print('Nie udało się uruchomić serwera (zajęte porty).')
        sys.exit(1)

    url = f'http://localhost:{server.server_port}/'
    print()
    print('  Symulator ATtiny24 - stanowisko LTM')
    print(f'  Adres: {url}')
    if BIN is None:
        print('  UWAGA: nie znaleziono avr-gcc - kompilacja nie zadziała (patrz README).')
    else:
        print(f'  Kompilator: avr-gcc {VERSION} ({BIN})')
        if VERSION != '7.3.0':
            print('  UWAGA: biblioteka Arduino wymaga avr-gcc 7.3.0 - programy z Arduino.h mogą się nie zlinkować.')
            print('         Najprościej: pip install platformio && pio pkg install -g -t platformio/toolchain-atmelavr@1.70300.191015')
    print('  Ctrl+C wyłącza symulator.')
    print()
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
