#include <Arduino.h>

// Miganie jedną diodą: PA0 w gałęzi tranzystora T1 (Led1).
// Dioda świeci, gdy na PAx jest stan wysoki i tranzystor jej gałęzi przewodzi.

void setup() {
  DDRA = 0b11111111;      // PA0..PA7 - wyjścia (anody diod), to samo co DDRA = 255
  DDRB = 0b00001011;      // PB0, PB1, PB3 - wyjścia, PB2 (fotodioda) - wejście
  PORTB |= _BV(PB0);      // włącz tranzystor T1 - aktywna gałąź diod Led1
}

void loop() {
  PORTA = 0b00000001;     // zapal diodę na PA0
  delay(1000);
  PORTA = 0b00000000;     // zgaś wszystkie diody
  delay(1000);
}
