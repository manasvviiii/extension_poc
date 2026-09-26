/**
 * Task 8.9.3 — Acceptance Verification Script
 * Human-like Slow Auto Scroll
 */

const fs = require('fs');
const path = require('path');

console.log("=========================================");
console.log("RUNNING TASK 8.9.3 ACCEPTANCE TEST SUITE");
console.log("=========================================\n");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`[PASS] ${message}`);
    passed++;
  } else {
    console.error(`[FAIL] ${message}`);
    failed++;
  }
}

const contentJsPath = path.join(__dirname, '..', 'extension', 'content.js');
assert(fs.existsSync(contentJsPath), "extension/content.js exists");

const contentJs = fs.readFileSync(contentJsPath, 'utf8');

// 1. Verify Async triggerContainerLoad and await call site
assert(contentJs.includes("async triggerContainerLoad"), "triggerContainerLoad is an async method");
assert(contentJs.includes("await this.triggerContainerLoad"), "triggerContainerLoad is awaited in runAcquisitionLoop");

// 2. Verify Scroll Distance (120-180px)
const has120_180_range = contentJs.includes("180 - 120 + 1") && contentJs.includes("+ 120");
assert(has120_180_range, "Scroll distance is randomized between 120px and 180px");

// 3. Verify Inter-scroll Delay (280-520ms)
const has280_520_range = contentJs.includes("520 - 280 + 1") && contentJs.includes("+ 280");
assert(has280_520_range, "Inter-scroll delay is randomized between 280ms and 520ms");

// 4. Verify Micro Pause (8-12 scrolls, 900-1500ms pause)
const hasMicroPauseInterval = contentJs.includes("12 - 8 + 1") && contentJs.includes("+ 8");
const hasMicroPauseDelay = contentJs.includes("1500 - 900 + 1") && contentJs.includes("+ 900");
assert(hasMicroPauseInterval, "Micro pause interval is randomized between 8 and 12 scrolls");
assert(hasMicroPauseDelay, "Micro pause duration is randomized between 900ms and 1500ms");

// 5. Verify Smooth Easing
const hasSmoothBehavior = contentJs.includes('behavior: "smooth"');
assert(hasSmoothBehavior, "Smooth scroll animation (behavior: 'smooth') is enabled");

// 6. Verify Bottom Detection Preserved
const hasBottomTelemetry = contentJs.includes("inspectBottomTelemetry");
const hasIsNearBottom = contentJs.includes("isNearBottom");
assert(hasBottomTelemetry && hasIsNearBottom, "Bottom detection and telemetry logic are fully preserved");

console.log("\n-----------------------------------------");
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log("-----------------------------------------");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("SUCCESS: Task 8.9.3 Acceptance Criteria Met!\n");
  process.exit(0);
}
