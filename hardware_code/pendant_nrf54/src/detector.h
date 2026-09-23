#pragma once
#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

bool loom_detector_update(float ax, float ay, float az, float gx, float gy, float gz, uint32_t now_ms);

#ifdef __cplusplus
}
#endif
