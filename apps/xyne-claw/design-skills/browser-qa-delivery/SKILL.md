---
name: browser-qa-delivery
description: Validate a Design Studio HTML artifact in the sandbox browser, fix rendering and runtime defects, then deliver exactly the tested file.
---

# Browser QA and delivery

Before delivery:

1. Serve or open the artifact inside the writable sandbox.
2. Navigate with the sandbox Playwright tools and capture a desktop screenshot.
3. Inspect the semantic snapshot, browser console, and failed network requests.
4. Test the primary interaction and keyboard focus path.
5. Repeat at a narrow mobile viewport. Check overflow and content order.
6. Fix defects and rerun the affected checks.
7. Ensure the delivered document contains no inspector code, secrets, local-only
   URLs, missing assets, or development placeholders.
8. Call `sandbox-deliver-files` with the exact HTML file that passed QA.

Do not paste the full source into chat. The attachment is the product; the final
text should only identify what was delivered and any unavoidable limitation.
