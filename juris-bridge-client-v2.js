(function () {
  "use strict";

  function b64url(bytes) {
    let binary = "";
    const view = new Uint8Array(bytes);
    for (let index = 0; index < view.length; index += 1) binary += String.fromCharCode(view[index]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function submissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID().replace(/-/g, "");
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return b64url(bytes.buffer);
  }

  async function sha256Hex(value) {
    if (!window.crypto || !window.crypto.subtle) throw new Error("WEBCRYPTO_UNAVAILABLE");
    const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
    return Array.from(new Uint8Array(digest), function (byte) { return byte.toString(16).padStart(2, "0"); }).join("");
  }

  function normalizeAccessPhone(value) {
    const raw = String(value || "");
    const explicitInternational = /^\s*(?:\+|00)/.test(raw);
    let digits = raw.replace(/\D/g, "");
    if (digits.indexOf("00") === 0) digits = digits.slice(2);

    // La vinculación identifica el número argentino, no la forma en que fue
    // escrito. +54 9, +54 y el formato nacional de diez dígitos son iguales.
    if (/^549\d{10}$/.test(digits)) return "54" + digits.slice(3);
    if (/^54\d{10}$/.test(digits)) return digits;
    if (/^0\d{10}$/.test(digits)) return "54" + digits.slice(1);
    if (/^\d{10}$/.test(digits)) return "54" + digits;

    // Compatibilidad con la notación local histórica de Rosario: 0341 15...
    // o 341 15... equivalen a 341..., sin el prefijo móvil 15.
    const rosarioLocal = digits.match(/^(?:54)?0?(341)15(\d{7})$/);
    if (rosarioLocal) return "54" + rosarioLocal[1] + rosarioLocal[2];

    // Los teléfonos extranjeros conservan su código de país (por ejemplo 34).
    return digits;
  }

  async function encryptPayload(payload, config) {
    if (!window.crypto || !window.crypto.subtle) throw new Error("WEBCRYPTO_UNAVAILABLE");
    const publicKey = await window.crypto.subtle.importKey("jwk", config.publicKeyJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
    const aesKey = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);
    const encryptedKey = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawAesKey);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv: iv, additionalData: new TextEncoder().encode(config.keyId), tagLength: 128 }, aesKey, plaintext);
    return { alg: "RSA-OAEP-256+A256GCM", key_id: config.keyId, encrypted_key: b64url(encryptedKey), iv: b64url(iv.buffer), ciphertext: b64url(ciphertext) };
  }

  function payloadFromForm(form, rawMessage, id) {
    const data = new FormData(form);
    return {
      schema_version: "2026-08-11.v2",
      submission_id: id,
      submitted_at: new Date().toISOString(),
      source: "public_whatsapp_form",
      cliente: String(data.get("cliente") || "").trim(),
      contacto_whatsapp: String(data.get("contacto_whatsapp") || "").trim(),
      jurisdiccion: String(data.get("jurisdiccion") || "").trim(),
      product_mode: String(data.get("product_mode") || "Editorial Juris - jurisdiccional para abogados").trim(),
      tipo: String(data.get("tipo") || "Abogado").trim(),
      naturaleza: String(data.get("naturaleza") || "Fondo").trim(),
      perfil_servicio: String(data.get("perfil_servicio") || "").trim(),
      tema_materia: String(data.get("tema_materia") || "").trim(),
      consulta: window.anonymizeDirectData(String(data.get("consulta") || "").trim()),
      anonimizar_ia: true,
      consent_ia: Boolean(data.get("consent_ia")),
      consent_datos_sensibles: Boolean(data.get("consent_datos_sensibles")),
      raw_message: rawMessage
    };
  }

  function showNotice(notice, text, kind) {
    notice.textContent = text;
    notice.style.display = "block";
    notice.style.background = kind === "error" ? "#fdecea" : kind === "pending" ? "#fff4d6" : "#e8f6f3";
    notice.style.color = kind === "error" ? "#8a1c13" : kind === "pending" ? "#6b4f00" : "#0b5345";
  }

  function privacyMessage(codes) {
    const labels = {
      CORREO_ELECTRONICO: "correo electrónico",
      DNI_CUIL_CUIT: "DNI, CUIL o CUIT",
      TELEFONO_DE_TERCERO: "teléfono de un tercero",
      DOMICILIO_EXACTO: "domicilio exacto",
      NOMBRE_ROTULADO: "nombre real rotulado",
      CONTENIDO_NO_PERMITIDO: "contenido no permitido",
      PRIVACY_PREFLIGHT_MISSING: "control de privacidad no disponible"
    };
    const detected = codes.map(function (code) { return labels[code] || "dato identificatorio"; });
    return "La consulta no fue procesada. El formulario detectó: " + detected.join(", ")
      + ". Sustituya únicamente ese dato por un rol o seudónimo. Puede conservar fechas, ciudades, localidades, barrios y lugares de trabajo necesarios para la competencia.";
  }

  async function accessStatus(endpoint) {
    const response = await fetch(endpoint.replace(/\/$/, "") + "/api/access/status", { mode: "cors", cache: "no-store" });
    if (!response.ok) throw new Error("ACCESS_STATUS_UNAVAILABLE");
    return response.json();
  }

  async function accessCheck(endpoint, accessCode, phoneHash) {
    const response = await fetch(endpoint.replace(/\/$/, "") + "/api/access/check", {
      method: "POST",
      mode: "cors",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ access_code: accessCode, contact_phone_hash: phoneHash })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || ("HTTP_" + response.status));
    return result;
  }

  async function postIntake(endpoint, body) {
    const controller = new AbortController();
    const timer = window.setTimeout(function () { controller.abort(); }, 12000);
    try {
      const response = await fetch(endpoint.replace(/\/$/, "") + "/api/intake", { method: "POST", mode: "cors", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || ("HTTP_" + response.status));
      return result;
    } finally { window.clearTimeout(timer); }
  }

  function accessMessage(code) {
    const messages = {
      ACCESS_CODE_REQUIRED: "Debe ingresar el código de acceso SOLIA suministrado por JURIS o por el administrador.",
      ACCESS_CODE_INVALID: "Código incorrecto o no habilitado. La consulta no fue procesada. Verifique el código e inténtelo nuevamente.",
      ACCESS_CAMPAIGN_INACTIVE: "Este grupo de códigos todavía no está habilitado.",
      ACCESS_CODE_DRAFT: "Este código todavía no está habilitado.",
      ACCESS_CODE_SUSPENDED: "Este código se encuentra suspendido.",
      ACCESS_CODE_REVOKED: "Este código fue revocado.",
      ACCESS_CODE_EXHAUSTED: "Este código agotó las consultas disponibles. La consulta no fue procesada. Solicite un nuevo código.",
      ACCESS_CODE_EXPIRED: "Este código está vencido.",
      ACCESS_CODE_NOT_YET_VALID: "Este código todavía no se encuentra vigente.",
      ACCESS_CODE_BOUND_TO_OTHER_PHONE: "Este código está vinculado a otro número de WhatsApp.",
      ACCESS_CODE_IN_USE: "Este código ya tiene una consulta en proceso. La nueva consulta no fue enviada. El formulario lo habilitará cuando finalice la primera.",
      ACCESS_PHONE_REQUIRED: "Ingrese un número de WhatsApp válido para vincular el código.",
      ACCESS_VALIDATION_UNAVAILABLE: "El control de acceso está momentáneamente fuera de servicio. La consulta no fue procesada; intente nuevamente más tarde."
    };
    return messages[code] || "El código de acceso no pudo ser validado. La consulta no fue procesada.";
  }

  function attach(options) {
    const form = document.getElementById(options.formId || "consulta-form");
    const notice = document.getElementById(options.noticeId || "notice");
    const accessInput = document.getElementById("access_code");
    const accessNote = document.getElementById("access-code-note");
    const phoneInput = document.getElementById("contacto_whatsapp");
    if (!form || !notice) return;
    const config = window.JURIS_BRIDGE_CONFIG || {};
    let accessWatchTimer = null;
    let accessWatchGeneration = 0;

    function stopAccessWatch(submitButton, originalLabel, enableButton) {
      accessWatchGeneration += 1;
      if (accessWatchTimer !== null) window.clearTimeout(accessWatchTimer);
      accessWatchTimer = null;
      if (enableButton && submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }
    }

    async function watchAccessAvailability(submitButton, originalLabel) {
      stopAccessWatch(submitButton, originalLabel, false);
      const generation = accessWatchGeneration;
      const accessCode = String(accessInput && accessInput.value || "").trim().toUpperCase();
      const normalizedPhone = String(phoneInput && phoneInput.value || "").replace(/\D/g, "");
      const phoneHash = await sha256Hex(normalizedPhone);
      let consecutiveErrors = 0;
      submitButton.disabled = true;
      submitButton.textContent = "Código en uso — aguardando…";
      showNotice(notice, accessMessage("ACCESS_CODE_IN_USE"), "pending");

      async function poll() {
        if (generation !== accessWatchGeneration) return;
        try {
          const result = await accessCheck(config.endpoint, accessCode, phoneHash);
          consecutiveErrors = 0;
          if (result.available) {
            stopAccessWatch(submitButton, originalLabel, true);
            showNotice(notice, "El código ya está disponible. Puede enviar la nueva consulta.", "ok");
            return;
          }
          if (result.status !== "ACCESS_CODE_IN_USE") {
            stopAccessWatch(submitButton, originalLabel, true);
            showNotice(notice, accessMessage(result.status), "error");
            return;
          }
        } catch (_) {
          consecutiveErrors += 1;
          if (consecutiveErrors >= 3) {
            stopAccessWatch(submitButton, originalLabel, true);
            showNotice(notice, "No se pudo comprobar si el código ya está disponible. Intente enviarlo nuevamente en unos minutos.", "pending");
            return;
          }
        }
        accessWatchTimer = window.setTimeout(poll, 15000);
      }

      accessWatchTimer = window.setTimeout(poll, 15000);
    }
    if (accessInput && config.endpoint) {
      accessStatus(config.endpoint).then(function (status) {
        accessInput.required = Boolean(status.code_required);
        if (accessNote) accessNote.textContent = status.code_required ? "Código obligatorio. Se vinculará a este WhatsApp en el primer ingreso aceptado." : "Código preparado; todavía no es obligatorio.";
      }).catch(function () {
        if (accessNote) accessNote.textContent = "El estado del control de acceso no pudo comprobarse. El Worker realizará la validación al enviar.";
      });
    }
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const submitButton = form.querySelector("button[type='submit']");
      if (submitButton.disabled) return;
      const privacyViolations = window.detectSoliaPrivacyViolations ? window.detectSoliaPrivacyViolations(form) : ["PRIVACY_PREFLIGHT_MISSING"];
      if (privacyViolations.length) {
        showNotice(notice, privacyMessage(privacyViolations), "pending");
        return;
      }
      submitButton.disabled = true;
      const originalLabel = submitButton.textContent;
      submitButton.textContent = "Registrando consulta…";
      const id = submissionId();
      let text = window.buildWhatsappText(form);
      try {
        const data = new FormData(form);
        const payload = payloadFromForm(form, text, id);
        const envelope = await encryptPayload(payload, config);
        const normalizedPhone = normalizeAccessPhone(data.get("contacto_whatsapp"));
        const result = await postIntake(config.endpoint, {
          schema_version: payload.schema_version,
          submission_id: id,
          submitted_at: payload.submitted_at,
          access_code: String(data.get("access_code") || "").trim().toUpperCase(),
          routing: { source: payload.source, jurisdiction: payload.jurisdiccion, consent_ia: payload.consent_ia, consent_data: payload.consent_datos_sensibles, privacy_mode: "mandatory_v1", contact_phone_hash: await sha256Hex(normalizedPhone) },
          envelope: envelope
        });
        text += "\n\nID de ingreso automatico: " + result.intake_id;
        showNotice(notice, "CONSULTA REGISTRADA PARA PROCESAMIENTO AUTOMÁTICO. Se abrirá WhatsApp para confirmar el envío.", "ok");
      } catch (error) {
        const code = String(error && error.message || "");
        if (code.indexOf("ACCESS_") === 0) {
          if (code === "ACCESS_CODE_IN_USE") {
            await watchAccessAvailability(submitButton, originalLabel);
            return;
          }
          showNotice(notice, accessMessage(code), "error");
          submitButton.disabled = false;
          submitButton.textContent = originalLabel;
          return;
        }
        showNotice(notice, "NO SE PROCESÓ LA CONSULTA. SOLIA no confirmó el ingreso automático. No se abrirá WhatsApp ni se enviará el caso. Espere unos instantes y vuelva a intentarlo.", "error");
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
        return;
      }
      const whatsappUrl = "https://wa.me/" + options.whatsappNumber + "?text=" + window.encodeForQuery(text);
      window.setTimeout(function () { window.location.href = whatsappUrl; }, 500);
      window.setTimeout(function () { submitButton.disabled = false; submitButton.textContent = originalLabel; }, 3000);
    });

    [accessInput, phoneInput].forEach(function (input) {
      if (!input) return;
      input.addEventListener("input", function () {
        const submitButton = form.querySelector("button[type='submit']");
        if (accessWatchTimer !== null && submitButton) {
          stopAccessWatch(submitButton, "Enviar consulta", true);
          showNotice(notice, "Código o WhatsApp modificado. Puede intentar el envío con los nuevos datos.", "pending");
        }
      });
    });
  }

  window.JurisWhatsAppBridge = Object.freeze({ attach: attach, encryptPayload: encryptPayload, payloadFromForm: payloadFromForm, accessMessage: accessMessage, accessCheck: accessCheck, normalizeAccessPhone: normalizeAccessPhone });
}());
