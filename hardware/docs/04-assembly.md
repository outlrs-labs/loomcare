# 04 — Assembly procedure

## Bench stage

1. Create a build record and assign a unique prototype serial.
2. Inspect the XIAO, BMI270 and battery; record supplier/lot information.
3. Connect only XIAO + BMI270 and confirm I²C detection.
4. Add button, then LED, then haptic driver/motor, then piezo. Test after each addition.
5. Flash firmware and set a unique private six-digit BLE PIN over USB serial.
6. Pair to the Locket Lab or parent-phone gateway and run every event type.
7. Measure idle, connected, advertising and alert current before enclosure assembly.

## Mechanical stage

1. Verify the lanyard is breakaway or otherwise designed to reduce entanglement risk.
2. Secure the cell without puncture, compression or sharp-edge contact.
3. Keep the antenna zone clear.
4. Position the IMU consistently with the orientation recorded in the build record.
5. Confirm the button is reachable and distinguishable by touch.
6. Confirm haptic and sound remain noticeable through the closed enclosure.
7. Close the enclosure reversibly for prototypes; do not claim an IP rating without a defined ingress test.

## Stop conditions

Stop and isolate the unit for abnormal heat, cell swelling, intermittent power, damaged insulation, charging outside the cell rating or unexplained current draw.
