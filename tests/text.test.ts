import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanText } from "../src/text.js";

test("preserva el texto y signos expresivos sin añadir autor", () => {
  assert.equal(cleanText("  ¡Hola! ¿Cómo estás?  "), "¡Hola! ¿Cómo estás?");
});
test("no pronuncia código, etiquetas ni URL completas", () => {
  assert.equal(cleanText("**hola** <@123> https://example.com/privado"), "hola enlace.");
  assert.equal(cleanText("```const secreto = 1;```"), "");
});
test("limita textos largos sin superar el límite más una elipsis", () => {
  const value = cleanText("a".repeat(400), 260);
  assert.equal(value.length, 261);
  assert.ok(value.endsWith("…"));
});
