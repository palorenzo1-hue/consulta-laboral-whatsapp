import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../solia-emergency-guard-v2.js", import.meta.url), "utf8");
const attributes = new Map();
const button = {
  disabled: false,
  textContent: "Enviar consulta",
  setAttribute(name, value) { attributes.set(name, value); },
  getAttribute(name) { return attributes.get(name) || null; },
};
const notice = { textContent: "", style: {} };
const submitListeners = [];
const form = {
  dataset: {},
  querySelector(selector) { return selector === "button[type='submit']" ? button : null; },
  addEventListener(type, listener, capture) { if (type === "submit") submitListeners.push({ listener, capture }); },
};
let originalAttachCalls = 0;
const windowObject = {
  JURIS_BRIDGE_CONFIG: { endpoint: "https://worker.test" },
  JurisWhatsAppBridge: {
    attach() { originalAttachCalls += 1; },
    encryptPayload() {}, payloadFromForm() {}, accessMessage() {}, accessCheck() {}, normalizeAccessPhone() {},
  },
  setTimeout() { return 1; },
};
const context = {
  window: windowObject,
  document: { getElementById(id) { return id === "consulta-form" ? form : id === "notice" ? notice : null; } },
  fetch: async () => ({ ok: true, json: async () => ({ ok: true, accepting_intakes: false, service_status: "EMERGENCY_STOPPED", message: "mantenimiento confirmado" }) }),
  MutationObserver: class { observe() {} },
};

vm.runInNewContext(source, context, { filename: "solia-emergency-guard-v2.js" });
windowObject.JurisWhatsAppBridge.attach({});
await new Promise((resolve) => setImmediate(resolve));

assert.equal(originalAttachCalls, 1);
assert.equal(button.disabled, true);
assert.equal(button.textContent, "SOLIA temporalmente fuera de línea");
assert.equal(attributes.get("aria-disabled"), "true");
assert.equal(form.dataset.soliaEmergencyStopped, "true");
assert.equal(notice.textContent, "mantenimiento confirmado");
assert.equal(submitListeners.length, 1);
assert.equal(submitListeners[0].capture, true);

const event = {
  prevented: false,
  stopped: false,
  preventDefault() { this.prevented = true; },
  stopImmediatePropagation() { this.stopped = true; },
};
submitListeners[0].listener(event);
assert.equal(event.prevented, true);
assert.equal(event.stopped, true);

console.log("OK: el guard en ejecución deshabilita el botón y corta submit antes del cliente de intake");
