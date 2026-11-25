#include <Arduino.h>

// Wszystkie diody świecą, gdy fotodioda (PB2) wykrywa znacznik.
// Przy obracającej się płytce diody błyskają raz na obrót, zawsze w tym samym miejscu.

void setup() {
  DDRA = 0b11111111;      // PA0..PA7 - wyjścia (anody diod)
  DDRB = 0b00001011;      // PB0, PB1 (tranzystory) - wyjścia, PB2 (fotodioda) - wejście
  PORTB = 0b00000011;     // T1 i T2 włączone - obie linie diod aktywne
}

void loop() {
  if (!(PINB & _BV(PB2))) {   // fotodioda w stanie niskim = wykrycie
    PORTA = 0b11111111;       // wszystkie diody świecą
  } else {
    PORTA = 0b00000000;       // wszystkie zgaszone
  }
}
