(function () {
  "use strict";

  var OUTAGE = "SOLIA se encuentra temporalmente fuera de línea por una revisión técnica. La consulta no fue procesada ni consumió el código. Aguarde 15 minutos y vuelva a intentarlo.";
  var STOPPED_LABEL = "SOLIA temporalmente fuera de línea";
  var CHECK_INTERVAL_MS = 15000;
  var stopped = false;

  function showMessage(text) {
    var notice = document.getElementById("notice");
    if (!notice) return;
    if (notice.textContent !== (text || OUTAGE)) notice.textContent = text || OUTAGE;
    notice.style.display = "block";
    notice.style.background = "#fdecea";
    notice.style.color = "#8a1c13";
  }

  function submitButton() {
    var form = document.getElementById("consulta-form");
    return form ? form.querySelector("button[type='submit']") : null;
  }

  function enforceStopped(message) {
    stopped = true;
    var form = document.getElementById("consulta-form");
    var button = submitButton();
    if (form && form.dataset.soliaEmergencyStopped !== "true") form.dataset.soliaEmergencyStopped = "true";
    if (button) {
      if (!button.disabled) button.disabled = true;
      if (button.textContent !== STOPPED_LABEL) button.textContent = STOPPED_LABEL;
      if (button.getAttribute("aria-disabled") !== "true") button.setAttribute("aria-disabled", "true");
    }
    showMessage(message || OUTAGE);
  }

  function poll() {
    var config = window.JURIS_BRIDGE_CONFIG || {};
    var endpoint = String(config.endpoint || "").replace(/\/$/, "");
    if (!endpoint) {
      enforceStopped(OUTAGE);
      return;
    }
    fetch(endpoint + "/api/access/status", { mode: "cors", cache: "no-store" })
      .then(function (response) { return response.json().then(function (body) { return { response: response, body: body }; }); })
      .then(function (result) {
        if (!result.response.ok || result.body.accepting_intakes !== true) {
          enforceStopped(result.body.message || OUTAGE);
          return;
        }
        if (stopped) {
          enforceStopped("SOLIA volvió a estar disponible. Recargue esta página para iniciar una consulta nueva desde un estado limpio.");
        }
      })
      .catch(function () {
        enforceStopped("SOLIA no pudo confirmar la disponibilidad del circuito. La consulta no fue procesada ni consumió el código. Aguarde 15 minutos y vuelva a intentarlo.");
      })
      .finally(function () { window.setTimeout(poll, CHECK_INTERVAL_MS); });
  }

  function attachGuard() {
    var form = document.getElementById("consulta-form");
    if (!form) return;
    form.addEventListener("submit", function (event) {
      if (!stopped) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      enforceStopped(OUTAGE);
    }, true);
    var button = submitButton();
    if (button) {
      var observer = new MutationObserver(function () {
        if (stopped && (!button.disabled || button.textContent !== STOPPED_LABEL || button.getAttribute("aria-disabled") !== "true")) {
          enforceStopped();
        }
      });
      observer.observe(button, { attributes: true, childList: true, characterData: true, subtree: true });
    }
    poll();
  }

  var bridge = window.JurisWhatsAppBridge;
  if (!bridge || typeof bridge.attach !== "function") {
    enforceStopped(OUTAGE);
    return;
  }
  var originalAttach = bridge.attach;
  window.JurisWhatsAppBridge = Object.freeze({
    attach: function (options) {
      originalAttach(options);
      attachGuard();
    },
    encryptPayload: bridge.encryptPayload,
    payloadFromForm: bridge.payloadFromForm,
    accessMessage: bridge.accessMessage,
    accessCheck: bridge.accessCheck,
    normalizeAccessPhone: bridge.normalizeAccessPhone
  });
  window.SoliaEmergencyGuard = Object.freeze({ isStopped: function () { return stopped; } });
}());
