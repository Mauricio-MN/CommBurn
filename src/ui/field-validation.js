const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
let nextValidationId = 1;

export function validateNumberField(input, { minimum = -Infinity, maximum = Infinity } = {}) {
  const rawValue = String(input.value ?? "").trim();
  if (input.validity?.badInput) return { valid: false, code: "invalid" };
  if (!rawValue) return { valid: false, code: "required" };
  if (!NUMBER_PATTERN.test(rawValue)) return { valid: false, code: "invalid" };

  const value = Number(rawValue);
  if (!Number.isFinite(value)) return { valid: false, code: "invalid" };

  const inputMinimum = input.min === "" ? -Infinity : Number(input.min);
  const inputMaximum = input.max === "" ? Infinity : Number(input.max);
  const effectiveMinimum = Math.max(minimum, Number.isFinite(inputMinimum) ? inputMinimum : -Infinity);
  const effectiveMaximum = Math.min(maximum, Number.isFinite(inputMaximum) ? inputMaximum : Infinity);
  if (value < effectiveMinimum || input.validity?.rangeUnderflow) {
    return { valid: false, code: "minimum", minimum: effectiveMinimum };
  }
  if (value > effectiveMaximum || input.validity?.rangeOverflow) {
    return { valid: false, code: "maximum", maximum: effectiveMaximum };
  }
  if (input.validity?.stepMismatch) {
    const step = input.step === "" ? 1 : Number(input.step);
    return { valid: false, code: "step", step };
  }
  return { valid: true, value };
}

export function numberFieldErrorMessage(input, result, t, fallbackLabel) {
  const label = input.closest("label")?.firstChild?.textContent?.trim()
    || input.getAttribute("aria-label")
    || input.dataset.layerProperty
    || input.id
    || fallbackLabel;
  const unit = input.dataset.unit
    || input.closest(".input-with-unit")?.querySelector("span")?.textContent?.trim()
    || input.closest(".field")?.querySelector(".unit-note")?.textContent?.trim()
    || "";
  const values = { label, unit: unit ? ` ${unit}` : "" };
  if (result.code === "minimum") values.minimum = result.minimum;
  if (result.code === "maximum") values.maximum = result.maximum;
  if (result.code === "step") values.step = result.step;
  return t(`ui.validation.${result.code}`, values);
}

export function showNumberFieldError(input, result, t, fallbackLabel) {
  clearNumberFieldError(input);
  const errorId = input.dataset.validationErrorId || `number-field-error-${nextValidationId++}`;
  input.dataset.validationErrorId = errorId;
  const error = document.createElement("small");
  error.className = "field-error";
  error.id = errorId;
  error.setAttribute("role", "alert");
  error.textContent = numberFieldErrorMessage(input, result, t, fallbackLabel);
  input.closest("label")?.append(error);
  input.setAttribute("aria-invalid", "true");
  const describedBy = new Set((input.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
  describedBy.add(errorId);
  input.setAttribute("aria-describedby", [...describedBy].join(" "));
  input.setCustomValidity(error.textContent);
}

export function clearNumberFieldError(input) {
  const errorId = input.dataset.validationErrorId;
  if (!errorId) return;
  input.closest("label")?.querySelector(`#${errorId}`)?.remove();
  input.removeAttribute("aria-invalid");
  const describedBy = (input.getAttribute("aria-describedby") ?? "").split(/\s+/).filter((id) => id && id !== errorId);
  if (describedBy.length) input.setAttribute("aria-describedby", describedBy.join(" "));
  else input.removeAttribute("aria-describedby");
  input.setCustomValidity("");
}
