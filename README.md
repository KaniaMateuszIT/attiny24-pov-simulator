<h1 align="center">ATtiny24 POV Simulator</h1>

<p align="center">
  A cycle-accurate ATtiny24 emulator with a virtual spinning-LED (POV) lab board,<br>
  a real avr-gcc toolchain, a BASCOM-AVR translator and a debugger – all in your browser, nothing to install.
</p>

<p align="center">
  <a href="https://kaniamateuszit.github.io/attiny24-pov-simulator/"><b>▶ Try it online</b></a>
  &nbsp;·&nbsp; <a href="#quick-start">Download and run locally</a>
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="Simulator: C++ editor, spinning POV board with a light wave, live schematic" width="100%">
</p>

---

## Why

At the *Microprocessor Technology Lab* (Silesian University of Technology) we program a small rotating
board: an **ATtiny24** drives **16 LEDs on two arms**, a **photodiode** sees a marker once per revolution,
and the image appears only when the board spins (persistence of vision).

Lab time is short and the board is shared. This simulator lets you write, compile, upload and debug the same
programs at home – and see what the board would actually show, not just pin states.

## Features

**Real compilation, byte-identical to the lab**
- Bundled **avr-gcc 7.3.0** and the **ATTinyCore** Arduino library – the same toolchain and flags PlatformIO uses
  (`board = attiny24`, `framework = arduino`), so the `.hex` is identical to the one flashed in the lab.
- **C / C++** with `Arduino.h` (`setup()` / `loop()`) or bare-metal with your own `main()`.
- **BASCOM-AVR**: a translator turns a practical subset of BASCOM into C (you can view the generated code).
- Simulated **USBasp + avrdude** upload, including realistic messages and errors (unplug the programmer and see).

**Cycle-accurate ATtiny24**
- Instruction-by-instruction emulation at 8 MHz with exact cycle counts.
- GPIO with pull-ups, **Timer0 / Timer1** (all modes, PWM, CTC), **INT0**, **PCINT**, **watchdog**, **EEPROM**,
  sleep modes, `CLKPR`, and **fuse bits** (wrong clock fuses really stop the clock).

**The lab board, modelled**
- 16 LEDs on two opposite arms (red branch via T1/PB0, green branch via T2/PB1), BS170 transistors,
  photodiode on PB2 (INT0).
- Motor with inertia, adjustable speed, jitter, direction and marker width.
- **POV rendering as the eye sees it** – rings, text and animations appear only when timing is right.
- Live **schematic** with logic levels on every net.

**Your language, your colours**
- Interface in **English or Polish** – switch with the PL / EN buttons at the top (help, console messages,
  diagnostics and compiler hints are translated too). The browser language is used on first start.
- Four **colour themes**: Dark, Light, Ocean and High contrast – the board view follows the theme too.

**Ready for lab reports**
- **📷 PNG** of the board view and **⏺ GIF**: a 4-second animation of the spinning board (palette tuned to the recording).
- Logic analyzer export: the visible waveforms as **PNG**, the state changes as **CSV**
  (semicolon and decimal comma in Polish mode, so Excel opens it directly).

**Debugging and insight**
- Pause, step by line (F10) or instruction (F11), breakpoints, registers with named bits, variables,
  RAM/stack map, EEPROM view, disassembly listing.
- **Logic analyzer** for all pins plus an "in interrupt" channel.
- **CPU utilization**: how much time goes to the main program, interrupts, `delay()` busy-waiting and sleep –
  per function and per source line, counted from real cycles.
- **Diagnostics** for classic mistakes: missing ISR, stack overflowing into variables, watchdog reset loops,
  pull-up instead of output, wrong `F_CPU`, interrupts that take too long… with hints for compiler errors.

## Quick start

### Online

Open **https://kaniamateuszit.github.io/attiny24-pov-simulator/** – the examples run straight away
(they come precompiled). There is no compiler online, so to write your own programs use the local version.

### Windows

Requirements: **Windows 10/11** and **Edge or Chrome**. No installation – the compiler is included.

1. Download the repository (**Code → Download ZIP**) and unpack it, or `git clone` it.
   Keep it in a path **without non-ASCII characters** (avr-gcc 7 does not handle them).
2. Double-click **`Symulator.bat`**.
3. The browser opens at `http://localhost:8024/` – on first start a demo is compiled, uploaded and the board starts spinning.

Closing the console window stops the simulator. If port 8024 is busy, the server picks the next free one
(8024–8043) and prints the address.

### Linux and macOS

Requirements: **Python 3**, a browser and **avr-gcc**. The Arduino library in `arduino/` was built with
avr-gcc **7.3.0**, so programs using `Arduino.h` need exactly that version – the easiest way to get it is PlatformIO's
toolchain (works on every OS):

```sh
pip install platformio
pio pkg install -g -t platformio/toolchain-atmelavr@1.70300.191015
./symulator.sh            # or: python3 serwer/serwer.py
```

The server looks for avr-gcc in `AVR_GCC_BIN`, then in PlatformIO's toolchain, then on `PATH`
(e.g. `apt install gcc-avr avr-libc` / `brew install avr-gcc`). With a different gcc version BASCOM programs and
C/C++ with your own `main()` still work; only Arduino-style programs may fail to link.

Tip: the address can preselect an example, language and theme, e.g.
`http://localhost:8024/#przyklad=02_licznik.cpp&lang=en&theme=light`.

## Examples

The **Przykłady** (Examples) menu contains the basic lab exercises, each in C++ and BASCOM:

| Example | What it shows |
|---|---|
| `01_miganie` | Blinking a single LED – port configuration, `delay` |
| `02_licznik` | Binary counter on 8 LEDs |
| `03_fala` | A light wave travelling from the centre to the edge – rings on the spinning board |
| `04_fotodioda` | Reading the photodiode: all LEDs flash once per revolution |

Your own programs are kept in the browser between sessions; **Otwórz / Zapisz** (Open / Save) work with files on disk.

## Keyboard shortcuts

| Key | Action |
|---|---|
| F7 | Compile |
| F5 | Compile and upload |
| F8 | Pause / resume |
| F10 | Step one source line |
| F11 | Step one instruction |
| Ctrl+S | Save the program to a file |

## How it works

```
Symulator.bat ──► serwer/serwer.ps1   local HTTP server (Windows PowerShell 5.1)
symulator.sh  ──► serwer/serwer.py    the same server in Python (Linux, macOS, Windows)
                    ├─ serves aplikacja/        the web app
                    └─ runs  avr-gcc, nm, objdump  ──► hex, symbols, line table, listing

aplikacja/js/
  avr.js            ATtiny24 core and peripherals, cycle-accurate
  stanowisko.js     the lab board: motor, photodiode, LEDs, POV light accumulation
  widok.js          board rendering            schemat.js     live schematic
  bascom.js         BASCOM → C translator      kompilacja.js  build results (hex, symbols, lines)
  analizator.js     logic analyzer             wykorzystanie.js  CPU utilization profiler
  i18n.js, en.js    PL / EN interface switch and the English dictionary
  eksport.js        PNG / GIF / CSV export (GIF encoder included, no libraries)
  main.js           UI: editor, upload, debugger, panels
```

Everything runs locally; the only reason for the server is to run the real compiler.
The online version (GitHub Pages, `.github/workflows/pages.yml`) is the same `aplikacja/` folder; instead of
compiling, the examples use build results stored in `aplikacja/przyklady/build/`. After changing an example,
start the simulator and run `node tools/zbuduj-przyklady.mjs` to refresh them.

## Limitations

- ADC, analog comparator, USI and Timer1 input capture are simplified (the lab board does not use them).
- BASCOM: a subset of the language (listed in the **Pomoc** / Help tab); no `String` or `Print`;
  `Sub` / `Function` parameters are passed by value unless declared `Byref`.
- Comments in the bundled example programs are in Polish.
- The bundled compiler is for Windows; on Linux/macOS you install avr-gcc yourself (see above).

## Author

Created by **Mateusz Kania** for the Microprocessor Technology Lab at the Silesian University of Technology.

## License

The simulator source code is released under the [MIT License](LICENSE).
The bundled toolchain and Arduino core keep their own licenses – see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
