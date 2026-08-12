import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = fs.readFileSync(path.join(root, "juris-bridge-client-v2.js"), "utf8");
const browserContext = { window: {} };
vm.runInNewContext(client, browserContext);
const normalizePhone = browserContext.window.JurisWhatsAppBridge.normalizeAccessPhone;

assert.equal(normalizePhone("341 555-2945"), "543415552945");
assert.equal(normalizePhone("0341 555-2945"), "543415552945");
assert.equal(normalizePhone("+54 341 555-2945"), "543415552945");
assert.equal(normalizePhone("+54 9 341 555-2945"), "543415552945");
assert.equal(normalizePhone("0341 15 555-2945"), "543415552945");
assert.equal(normalizePhone("0054 9 341 555-2945"), "543415552945");
assert.equal(normalizePhone("+34 612 345 678"), "34612345678");
assert.equal(normalizePhone("+1 202 555 0187"), "12025550187");
assert.equal(normalizePhone("+7 916 123 4567"), "79161234567");

console.log("OK: formatos telefónicos equivalentes conservan una única vinculación");
