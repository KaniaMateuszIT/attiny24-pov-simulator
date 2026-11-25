' Pływające światło: dwie sąsiednie diody od środka do krawędzi i z powrotem, na obu gałęziach
$regfile = "attiny24.dat"
$crystal = 8000000

Const Krok = 70                  ' czas jednego kroku [ms]
Dim Pozycja As Byte, Fala As Byte

Config Porta = Output
Config Portb = &B00001011
Portb = &B00000011               ' T1 i T2 włączone

Do
  For Pozycja = 0 To 6           ' na zewnątrz
    Fala = &B00000011
    Shift Fala, Left, Pozycja
    Porta = Fala
    Waitms Krok
  Next Pozycja
  For Pozycja = 5 To 1 Step -1   ' z powrotem do środka
    Fala = &B00000011
    Shift Fala, Left, Pozycja
    Porta = Fala
    Waitms Krok
  Next Pozycja
Loop

End
