# 02 — BOM and sourcing

Record exact manufacturer part numbers and supplier invoices in the unit build record. Prices below are planning ranges, not quotations.

| Part | Baseline | Planning cost | Acceptance before assembly |
| --- | --- | ---: | --- |
| Controller | Plain Seeed XIAO nRF54L15 | ₹985–1,029 | Correct board, undamaged antenna/USB connector |
| Motion | BMI270 breakout | ≈ ₹512 | 3.3 V compatible; address strap documented |
| Battery | Protected 1S LiPo, 200 mAh | ₹79–150 | Protection circuit, polarity and cell marking verified |
| Haptic | Coin vibration motor + transistor/MOSFET + flyback diode | ₹120–300 | Driver current compatible with motor |
| Sound | 12 mm piezo | part of ₹65–100 group | Measured audible through intended enclosure |
| Input | Large tactile button | part of ₹65–100 group | Normally open, usable force with intended cap |
| Visual | RGB LED + suitable resistors | part of ₹65–100 group | Pinout identified before soldering |
| Mechanics | solder board, wire, printed case, pogo cradle, magnets, breakaway cord | ₹380–630 | No sharp edges; strain relief and safe cord design |

Expected prototype total: approximately ₹2,150–2,700.

## Incoming inspection

- Photograph labels and packaging.
- Check battery voltage and polarity before connecting it.
- Confirm BMI270 identity over I²C before permanent assembly.
- Reject swollen, dented or undocumented cells.
- Do not substitute pin-compatible-looking boards without a reviewed change record.
