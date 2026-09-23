#include "detector.h"
#include "fall_detector.h"

static FallDetector detector;

extern "C" bool loom_detector_update(float ax, float ay, float az, float gx, float gy, float gz, uint32_t now_ms)
{
	return detector.update(ax, ay, az, gx, gy, gz, now_ms);
}
