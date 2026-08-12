import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const client = fs.readFileSync(path.join(root, "juris-bridge-client-v2.js"), "utf8");

assert.match(
  client,
  /ACCESS_CODE_INVALID: "Código incorrecto o no habilitado\. La consulta no fue procesada\. Verifique el código e inténtelo nuevamente\."/,
);
assert.match(
  client,
  /ACCESS_CODE_EXHAUSTED: "Este código agotó las consultas disponibles\. La consulta no fue procesada\. Solicite un nuevo código\."/,
);

// Todo ACCESS_* debe mostrar el aviso y finalizar antes de construir wa.me.
assert.match(
  client,
  /if \(code\.indexOf\("ACCESS_"\) === 0\) \{[\s\S]*?showNotice\(notice, accessMessage\(code\), "error"\);[\s\S]*?return;[\s\S]*?\}\s*showNotice/,
);
const accessCatch = client.indexOf('if (code.indexOf("ACCESS_") === 0)');
const whatsappNavigation = client.indexOf('const whatsappUrl = "https://wa.me/"');
assert.ok(accessCatch >= 0 && whatsappNavigation > accessCatch);
assert.match(html, /juris-bridge-client-v2\.js\?v=20260812-phone-canonical-1/);

console.log("OK: código inválido o agotado informa el rechazo y no abre WhatsApp");
