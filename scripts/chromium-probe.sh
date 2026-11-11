#!/usr/bin/env bash
# Fallback for the e2e "Playwright OS deps" step (#910): when apt cannot reach the Ubuntu mirrors
# after retries, the runner image (which ships Chrome) usually already has Chromium's shared
# libraries. Warn, then pass only if the cached Playwright Chromium actually launches. The 45 s probe
# plus two 150 s apt attempts fits the step's 6 min budget (#602).
set -u
echo "::warning::Playwright OS deps could not be installed (apt unreachable); probing the runner image's libraries"
if timeout "${PROBE_TIMEOUT_SECONDS:-45}" node -e \
  "require('@playwright/test').chromium.launch().then((b) => b.close()).catch((e) => { console.error(e.message); process.exit(1); })"; then
  echo "chromium-probe: Chromium launches without the OS deps step"
else
  echo "::error::Chromium does not launch without its OS deps"
  exit 1
fi
