import assert from "node:assert/strict";
import fs from "node:fs";

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const guard = fs.readFileSync(new URL("../solia-emergency-guard-v2.js", import.meta.url), "utf8");

assert.match(index, /id="consulta-form"/);
assert.match(index, /juris-bridge-client-v2\.js\?v=20260813-outage-notice-1/);
assert.match(index, /solia-emergency-guard-v2\.js\?v=20260814-emergency-stop-2/);
assert.match(guard, /api\/access\/status/);
assert.match(guard, /accepting_intakes !== true/);
assert.match(guard, /no fue procesada ni consumió el código/);
assert.match(guard, /addEventListener\("submit"[\s\S]*true\)/);
assert.match(guard, /event\.stopImmediatePropagation\(\)/);
assert.match(guard, /if \(!button\.disabled\) button\.disabled = true/);
assert.match(guard, /MutationObserver/);

console.log("OK: GitHub conserva el formulario visible y bloquea submit durante emergencia");
