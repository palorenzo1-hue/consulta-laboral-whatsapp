(function () {
  "use strict";

  function b64url(bytes) {
    let binary = "";
    const view = new Uint8Array(bytes);
    for (let index = 0; index < view.length; index += 1) binary += String.fromCharCode(view[index]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function submissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID().replace(/-/g, "");
    }
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return b64url(bytes.buffer);
  }

  async function encryptPayload(payload, config) {
    if (!window.crypto || !window.crypto.subtle) throw new Error("WEBCRYPTO_UNAVAILABLE");
    const publicKey = await window.crypto.subtle.importKey(
      "jwk",
      config.publicKeyJwk,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"]
    );
    const aesKey = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);
    const encryptedKey = await window.crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, rawAesKey);
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv, additionalData: new TextEncoder().encode(config.keyId), tagLength: 128 },
      aesKey,
      plaintext
    );
    return {
      alg: "RSA-OAEP-256+A256GCM",
      key_id: config.keyId,
      encrypted_key: b64url(encryptedKey),
      iv: b64url(iv.buffer),
      ciphertext: b64url(ciphertext)
    };
  }

  function payloadFromForm(form, rawMessage, id) {
    const data = new FormData(form);
    return {
      schema_version: "2026-08-09.v1",
      submission_id: id,
      submitted_at: new Date().toISOString(),
      source: "public_whatsapp_form",
      cliente: data.get("anonimizar_ia") ? "CONSULTA_ANONIMIZADA" : String(data.get("cliente") || "").trim(),
      contacto_whatsapp: String(data.get("contacto_whatsapp") || "").trim(),
      jurisdiccion: String(data.get("jurisdiccion") || "").trim(),
      product_mode: String(data.get("product_mode") || "Editorial Juris - jurisdiccional para abogados").trim(),
      tipo: String(data.get("tipo") || "Abogado").trim(),
      naturaleza: String(data.get("naturaleza") || "Fondo").trim(),
      perfil_servicio: String(data.get("perfil_servicio") || "").trim(),
      tema_materia: String(data.get("tema_materia") || "").trim(),
      consulta: String(data.get("consulta") || "").trim(),
      anonimizar_ia: Boolean(data.get("anonimizar_ia")),
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

  async function postIntake(endpoint, body) {
    const controller = new AbortController();
    const timer = window.setTimeout(function () { controller.abort(); }, 12000);
    try {
      const response = await fetch(endpoint.replace(/\/$/, "") + "/api/intake", {
        method: "POST",
        mode: "cors",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || ("HTTP_" + response.status));
      return result;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function attach(options) {
    const form = document.getElementById(options.formId || "consulta-form");
    const notice = document.getElementById(options.noticeId || "notice");
    if (!form || !notice) return;
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      if (!form.reportValidity()) return;
      const submitButton = form.querySelector("button[type='submit']");
      if (submitButton.disabled) return;
      submitButton.disabled = true;
      const originalLabel = submitButton.textContent;
      submitButton.textContent = "Registrando consulta…";
      const id = submissionId();
      let text = window.buildWhatsappText(form);
      const config = window.JURIS_BRIDGE_CONFIG || {};
      try {
        const payload = payloadFromForm(form, text, id);
        const envelope = await encryptPayload(payload, config);
        const result = await postIntake(config.endpoint, {
          schema_version: payload.schema_version,
          submission_id: id,
          submitted_at: payload.submitted_at,
          routing: {
            source: payload.source,
            jurisdiction: payload.jurisdiccion,
            consent_ia: payload.consent_ia,
            consent_data: payload.consent_datos_sensibles
          },
          envelope: envelope
        });
        text += "\n\nID de ingreso automatico: " + result.intake_id;
        showNotice(notice, "CONSULTA REGISTRADA PARA PROCESAMIENTO AUTOMÁTICO. Se abrirá WhatsApp para confirmar el envío.", "ok");
      } catch (error) {
        showNotice(
          notice,
          "WhatsApp se abrirá, pero la cola automática no confirmó el ingreso. Conserve el mensaje enviado: Pablo deberá verificarlo manualmente.",
          "pending"
        );
      }
      const whatsappUrl = "https://wa.me/" + options.whatsappNumber + "?text=" + window.encodeForQuery(text);
      window.setTimeout(function () { window.location.href = whatsappUrl; }, 500);
      window.setTimeout(function () {
        submitButton.disabled = false;
        submitButton.textContent = originalLabel;
      }, 3000);
    });
  }

  window.JurisWhatsAppBridge = Object.freeze({ attach: attach, encryptPayload: encryptPayload, payloadFromForm: payloadFromForm });
}());
