' Wszystkie diody świecą, gdy fotodioda (PB2) wykrywa znacznik
$regfile = "attiny24.dat"
$crystal = 8000000

Config Porta = Output
Config Portb = &B00001011
Portb = &B00000011               ' T1 i T2 włączone

Czujnik Alias Pinb.2             ' fotodioda: 0 = wykrycie znacznika

Do
  If Czujnik = 0 Then
    Porta = &HFF
  Else
    Porta = 0
  End If
Loop

End
