#include <Arduino.h>

// Licznik binarny: każdy bit zmiennej licznik steruje jedną diodą (bit 0 -> PA0 ... bit 7 -> PA7).

uint8_t licznik = 0;

void setup() {
  DDRA = 0b11111111;
  DDRB = 0b00001011;
  PORTB |= _BV(PB0);      // aktywna gałąź diod T1
}

void loop() {
  PORTA = licznik;        // każdy bit licznika steruje jedną diodą
  delay(1000);
  licznik++;              // po 255 licznik przepełnia się i wraca do 0
}
