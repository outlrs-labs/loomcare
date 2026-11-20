# 03 — Wiring

## XIAO labels

| Function | Pin | Connection |
| --- | --- | --- |
| Button | D0 | Normally open to GND; firmware uses internal pull-up |
| Vibration | D1 | Transistor/MOSFET input; motor must not be driven directly from GPIO |
| Piezo | D2 | PWM, approximately 2.7 kHz |
| RGB red | D3 | Through calculated current-limit resistor |
| BMI270 SDA | D4 | I²C data, 3.3 V |
| BMI270 SCL | D5 | I²C clock, 3.3 V |
| RGB green | D8 | Through calculated current-limit resistor |
| RGB blue | D9 | Through calculated current-limit resistor |
| Battery | XIAO battery pads | Observe polarity; protected 1S cell only |

BMI270 baseline address is `0x68`. If the breakout is strapped to `0x69`, update the board overlay and build record together.

## Electrical rules

- Use a common ground.
- Keep all logic at 3.3 V.
- Fit the motor flyback diode in the correct direction.
- Route the motor and piezo return away from the IMU where practical.
- Keep copper, battery and enclosure material away from the XIAO antenna keep-out.
- Strain-relieve every wire before closing the enclosure.
- Calibrate the switched AIN7 battery divider against a multimeter before trusting percentages.

Before applying power, record resistance between supply and ground and have another person inspect polarity.
