#pragma once
#include <cmath>
#include <cstdint>

class FallDetector {
    float bx = 0, by = 0, bz = 1, px = 0, py = 0, pz = 1;
    uint32_t impactAt = 0, stillAt = 0, freeAt = 0, rotationAt = 0, cooldownAt = 0;
    bool impact = false, still = false, seenFree = false, seenRotation = false, cooldown = false;
public:
    bool update(float ax, float ay, float az, float gx, float gy, float gz, uint32_t now) {
        const float mag = std::sqrt(ax * ax + ay * ay + az * az);
        const float gyro = std::sqrt(gx * gx + gy * gy + gz * gz);
        if (!std::isfinite(mag) || !std::isfinite(gyro)) return false;
        if (cooldown) {
            if (uint32_t(now - cooldownAt) < 30000) return false;
            cooldown = false;
        }
        if (mag < .5f) { freeAt = now; seenFree = true; }
        if (gyro > 70) { rotationAt = now; seenRotation = true; }
        if (!impact) {
            const bool evidence = (seenFree && uint32_t(now - freeAt) < 1200) || (seenRotation && uint32_t(now - rotationAt) < 500);
            if ((mag > 2.6f && evidence) || mag > 3.2f) {
                impact = true; impactAt = now; still = false;
                px = bx; py = by; pz = bz;
            } else if (mag > .8f && mag < 1.2f && gyro < 40) {
                bx = .98f * bx + .02f * ax; by = .98f * by + .02f * ay; bz = .98f * bz + .02f * az;
            }
            return false;
        }
        if (uint32_t(now - impactAt) > 5000) { impact = false; still = false; return false; }
        const float base = std::sqrt(px * px + py * py + pz * pz);
        const float dot = (ax * px + ay * py + az * pz) / (mag * base + .0001f);
        const bool quiet = mag > .75f && mag < 1.25f && gyro < 30 && dot < .70f;
        if (!quiet) { still = false; return false; }
        if (!still) { still = true; stillAt = now; }
        if (uint32_t(now - stillAt) < 1600) return false;
        impact = false; still = false; cooldown = true; cooldownAt = now;
        return true;
    }
};
