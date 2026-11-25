' Licznik binarny: każdy bit zmiennej Licznik steruje jedną diodą (bit 0 -> PA0 ... bit 7 -> PA7)
$regfile = "attiny24.dat"
$crystal = 8000000

Dim Licznik As Byte

Config Porta = Output
Config Portb = &B00001011
Portb.0 = 1                      ' gałąź Led1 (T1)

Do
  Porta = Licznik
  Waitms 1000
  Incr Licznik                   ' po 255 jest 0
Loop

End
