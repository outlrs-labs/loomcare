#include <cassert>
#include "../hardware_code/pendant/include/fall_detector.h"
int main() {
    FallDetector detector;
    for (uint32_t t = 0; t < 3000; t += 20) assert(!detector.update(0, 0, 1, 0, 0, 0, t));
    assert(!detector.update(0, 0, .2, 0, 0, 0, 3000));
    assert(!detector.update(3, 0, 0, 100, 0, 0, 3100));
    bool fall = false;
    for (uint32_t t = 3200; t < 5200; t += 20) fall |= detector.update(1, 0, 0, 0, 0, 0, t);
    assert(fall);
    for (uint32_t t = 5200; t < 32000; t += 20) assert(!detector.update(3, 0, 0, 100, 0, 0, t));
    FallDetector spike;
    assert(!spike.update(0, 0, 4, 0, 0, 0, 2000));
    for (uint32_t t = 2100; t < 9000; t += 20) assert(!spike.update(0, 0, 1, 0, 0, 0, t));
    FallDetector accelOnly;
    for (uint32_t t = 0; t < 3000; t += 20) assert(!accelOnly.update(0, 0, 1, 0, 0, 0, t));
    assert(!accelOnly.update(3.5, 0, 0, 0, 0, 0, 3000));
    bool accelFall = false;
    for (uint32_t t = 3020; t < 5200; t += 20) accelFall |= accelOnly.update(1, 0, 0, 0, 0, 0, t);
    assert(accelFall);
    FallDetector softBump;
    for (uint32_t t = 0; t < 3000; t += 20) assert(!softBump.update(0, 0, 1, 0, 0, 0, t));
    assert(!softBump.update(2.9, 0, 0, 0, 0, 0, 3000));
    for (uint32_t t = 3020; t < 9000; t += 20) assert(!softBump.update(1, 0, 0, 0, 0, 0, t));
    FallDetector moving;
    moving.update(0, 0, .2, 0, 0, 0, 3000);
    moving.update(3, 0, 0, 100, 0, 0, 3100);
    for (uint32_t t = 3200; t < 10000; t += 20) assert(!moving.update(1, 0, 0, 100, 0, 0, t));
    return 0;
}
