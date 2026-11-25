# Third-party software

This repository bundles unmodified binaries and libraries so that the simulator works without installation.
They are **not** covered by the MIT License of the simulator; each keeps its original license.

| Folder | Component | Version | License | Source |
|---|---|---|---|---|
| `kompilator/` | GCC for AVR (avr-gcc, avr-g++, cc1, cc1plus, libgcc) | 7.3.0 | GPL-3.0-or-later with the GCC Runtime Library Exception | https://gcc.gnu.org/ |
| `kompilator/` | GNU Binutils (as, ld, nm, objcopy, objdump, size) | as shipped with the toolchain | GPL-3.0-or-later | https://www.gnu.org/software/binutils/ |
| `kompilator/avr/` | AVR Libc (headers, `libc.a`, startup files) | as shipped with the toolchain | Modified BSD license | https://github.com/avrdudes/avr-libc |
| `kompilator/bin/*.dll` | libiconv, winpthreads (MinGW runtime) | – | LGPL / MIT-style (see upstream) | https://www.gnu.org/software/libiconv/, https://www.mingw-w64.org/ |
| `arduino/` | ATTinyCore – Arduino core for ATtiny (headers and compiled `libFrameworkArduino.a`) | 1.5.2 | LGPL-2.1-or-later | https://github.com/SpenceKonde/ATTinyCore |

The toolchain binaries were taken from the PlatformIO package `toolchain-atmelavr` 1.70300.191015 and trimmed to
what is needed for the ATtiny24. The Arduino library was built from `framework-arduino-avr-attiny` 1.5.2 with the
same flags PlatformIO uses for `board = attiny24`.

The complete corresponding source code of the GPL/LGPL components is available from the upstream projects linked
above. If you need a copy of the exact sources for the versions included here, open an issue in this repository.
