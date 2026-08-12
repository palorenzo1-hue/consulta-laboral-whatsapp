import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const start = html.indexOf("  function detectSoliaPrivacyViolations(form) {");
const end = html.indexOf("  window.detectSoliaPrivacyViolations", start);
assert.ok(start >= 0 && end > start, "No se encontró el detector público");

const context = {
  FormData: class FormData {
    constructor(form) { this.form = form; }
    get(key) { return this.form[key] || ""; }
  }
};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);

function detect(consulta, tema = "") {
  return Array.from(context.detectSoliaPrivacyViolations({ consulta, tema_materia: tema }));
}

const stressSantaFe = "TRABAJADOR A comenzó el 10/04/2023 en un depósito logístico de Rosario para EMPLEADOR B, con sede administrativa en Santa Fe. Facturaba como monotributista, pero cumplía horario de 7 a 17, recibía órdenes, usaba herramientas empresarias y cobraba mensualmente. Alternaba tareas de depósito y reparto. El 20/02/2026 reclamó registración, jornada y diferencias salariales. Fue suspendido y despedido verbalmente el 18/06/2026. Conserva facturas, transferencias, mensajes, registros de ingreso y TESTIGOS 1 y 2. Analizar naturaleza laboral, convenio y categoría aplicables, jornada, registración, validez del despido, indemnizaciones, incidencia temporal de las reformas, competencia territorial en Rosario, prueba necesaria, medidas preliminares, posiciones defensivas y estrategia procesal.";
const temaSantaFe = "Relación laboral no registrada, falso monotributo, jornada, despido y competencia territorial en Rosario.";
const stressCordoba = "TRABAJADORA A ingresó el 01/08/2024 para EMPLEADOR C, empresa con sede en Buenos Aires, y prestaba tareas remotas desde Córdoba Capital, concurriendo dos veces por semana a una oficina de Villa Carlos Paz. Suscribió contratos sucesivos por tres meses, aunque realizaba atención permanente de clientes, cumplía horario y respondía a supervisores. El 15/02/2026 comunicó un embarazo y el 25/04/2026 le informaron que el último contrato no sería renovado. La relación terminó el 30/04/2026. Posee contratos, correos, recibos, chats y registros de conexión. Analizar fraude contractual, estabilidad, posible discriminación, indemnizaciones, régimen temporal aplicable, competencia entre Córdoba y Buenos Aires, procedimiento local, cargas probatorias, cautelares, defensas posibles y plan operativo.";
const temaCordoba = "Contratos temporales fraudulentos, despido por embarazo, discriminación y competencia territorial en Córdoba.";

assert.deepEqual(detect(stressSantaFe, temaSantaFe), []);
assert.deepEqual(detect(stressCordoba, temaCordoba), []);
assert.deepEqual(detect("Definir la ruta procesal aplicable conforme al art. 20 del CPL."), []);
assert.deepEqual(detect("TRABAJADOR A reside en barrio Echesortu, Rosario."), []);
assert.deepEqual(detect("Trabajador: Juan Pérez."), ["NOMBRE_ROTULADO"]);
assert.deepEqual(detect("Domicilio: calle Córdoba 1234, Rosario."), ["DOMICILIO_EXACTO"]);
assert.deepEqual(detect("La persona vive en calle Córdoba 1234, Rosario."), ["DOMICILIO_EXACTO"]);
assert.deepEqual(detect("Correo: tercero@example.com"), ["CORREO_ELECTRONICO"]);

console.log("OK: sensibilidad de privacidad equilibrada y consultas stress admitidas");
