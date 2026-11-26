"use strict";

// Server text the window shows is translated by the window, not here. These
// helpers keep the English text (for logs and older clients) and send the
// English source plus its {placeholder} values alongside, so the renderer can
// call t(messageKey, messageVars). scripts/i18n.js extracts the first argument
// of tr(), uiMessage() and uiError(), so it must be a plain string literal.

function fill(key, vars) {
  if (!vars) return key;
  return key.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) && vars[name] !== undefined && vars[name] !== null
      ? String(vars[name])
      : match,
  );
}

// uiMessage(<"Found {count} items">, { count: 3 })
//   -> { message: 'Found 3 items...', messageKey: 'Found {count} items...', messageVars: { count: 3 } }
// A third argument picks another field name: uiMessage(key, vars, 'reason')
//   -> { reason, reasonKey, reasonVars }
function uiMessage(key, vars = undefined, field = "message") {
  const result = { [field]: fill(key, vars), [`${field}Key`]: key };
  if (vars && Object.keys(vars).length) result[`${field}Vars`] = { ...vars };
  return result;
}

// uiError(key, vars) -> { error, errorKey, errorVars }
function uiError(key, vars = undefined) {
  return uiMessage(key, vars, "error");
}

// Marks a static string for extraction; the renderer looks it up with t(sameString).
function tr(key) {
  return key;
}

// An Error whose text the window can translate:
//   throw uiException(uiMessage(<"Keep it under {max} characters.">, { max }))
// sets error.message (English), error.messageKey and error.messageVars.
function uiException(fields, ErrorType = Error) {
  return Object.assign(new ErrorType(fields.message), fields);
}

// JSON error body for a caught error: { error, errorKey?, errorVars? }.
// Errors built with uiException carry their key; plain errors whose message is
// a tr() string are looked up by the window with t(error) as is.
function errorFields(error, fallback = "") {
  const fields = { error: (error && error.message) || fallback };
  if (error && error.message && error.messageKey) {
    fields.errorKey = error.messageKey;
    if (error.messageVars) fields.errorVars = error.messageVars;
  }
  return fields;
}

// Message fields for an error-classifier result: its translatable key when the
// classifier passed the raw message through, else its (tr-marked) userMessage,
// else `fallback` (fields from uiMessage or { message }).
function classificationFields(classification, fallback = {}) {
  if (classification && classification.userMessage && classification.userMessageKey) {
    const fields = { message: classification.userMessage, messageKey: classification.userMessageKey };
    if (classification.userMessageVars) fields.messageVars = classification.userMessageVars;
    return fields;
  }
  if (classification && classification.userMessage) return { message: classification.userMessage };
  return fallback;
}

module.exports = {
  uiMessage,
  uiError,
  uiException,
  errorFields,
  classificationFields,
  tr,
  fillUiText: fill,
};
