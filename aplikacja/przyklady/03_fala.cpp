#include <Arduino.h>

// Pływające światło: dwie sąsiednie diody przesuwają się od środka płytki do krawędzi i z powrotem.
// Gdy płytka się kręci, każda dioda rysuje okrąg - fala wygląda jak rozchodzący się pierścień.

#define WAVE_WIDTH  2     // ile sąsiednich diod świeci naraz (szerokość fali)
#define STEP_MS     70    // czas jednego kroku fali [ms] - mniej = szybciej

void setup() {
  DDRA = 0b11111111;      // PA0..PA7 - wyjścia (anody diod)
  DDRB = 0b00001011;      // PB0, PB1 (tranzystory) - wyjścia, PB2 (fotodioda) - wejście
  PORTB = 0b00000011;     // T1 i T2 włączone - obie linie diod aktywne
}

void loop() {
  const uint8_t wave = (1 << WAVE_WIDTH) - 1;   // np. 0b00000011 dla szerokości 2
  const uint8_t last = 8 - WAVE_WIDTH;          // ostatnia pozycja, przy której fala mieści się w linii

  for (uint8_t pos = 0; pos < last; pos++) {    // od środka na zewnątrz
    PORTA = wave << pos;
    delay(STEP_MS);
  }
  for (uint8_t pos = last; pos > 0; pos--) {    // z powrotem do środka
    PORTA = wave << pos;
    delay(STEP_MS);
  }
}
