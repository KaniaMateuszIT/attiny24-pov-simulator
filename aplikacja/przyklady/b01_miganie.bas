' Miganie jedną diodą: PA0 w gałęzi tranzystora T1 (Led1)
$regfile = "attiny24.dat"
$crystal = 8000000
$hwstack = 16
$swstack = 8
$framesize = 8

Config Porta = Output            ' PA0..PA7 - anody diod
Config Portb = &B00001011        ' PB0, PB1 - bramki tranzystorów, PB2 - fotodioda (wejście)
Portb.0 = 1                      ' włącz T1 - aktywna gałąź Led1

Do
  Porta.0 = 1                    ' zapal diodę na PA0
  Waitms 1000
  Porta.0 = 0                    ' zgaś
  Waitms 1000
Loop

End
