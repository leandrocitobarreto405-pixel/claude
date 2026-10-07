import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACEITA_MIDIA,
  bytesRecebidos,
  motivoDoDrive,
  tamanhoLegivel,
  tipoDaMidia,
  validarMidia,
} from "./midia-os";

test("formatos do iPhone, com ou sem tipo informado", () => {
  assert.equal(tipoDaMidia("IMG_8315.MOV", ""), "video/quicktime");
  assert.equal(tipoDaMidia("IMG_8315.mov", "video/quicktime"), "video/quicktime");
  assert.equal(tipoDaMidia("IMG_1.HEIC", "application/octet-stream"), "image/heic");
  assert.equal(tipoDaMidia("video.mp4", null), "video/mp4");
  assert.equal(tipoDaMidia("nota.pdf", "application/pdf"), null);
  assert.ok(ACEITA_MIDIA.includes(".mov") && ACEITA_MIDIA.includes(".heic"));
});

test("validação com o motivo real", () => {
  assert.deepEqual(validarMidia("IMG_8315.mov", "", 48 * 1024 ** 2), {
    ok: true,
    tipo: "video/quicktime",
  });
  assert.ok(validarMidia("v.mov", "video/quicktime", 600 * 1024 ** 2).ok, "600 MB passa");
  const grande = validarMidia("v.mov", "video/quicktime", 3 * 1024 ** 3);
  assert.equal(grande.ok, false);
  assert.match(!grande.ok ? grande.motivo : "", /grande demais \(3,0 GB\).*2,0 GB/);
  const pdf = validarMidia("nota.pdf", "application/pdf", 1000);
  assert.match(!pdf.ok ? pdf.motivo : "", /Formato \.pdf não aceito/);
  assert.equal(validarMidia("a.jpg", "image/jpeg", 0).ok, false);
});

test("tamanho e erros do Drive em português", () => {
  assert.equal(tamanhoLegivel(48 * 1024 ** 2), "48 MB");
  assert.equal(tamanhoLegivel(300 * 1024), "300 KB");
  assert.match(motivoDoDrive(403, '{"reason":"storageQuotaExceeded"}'), /sem espaço/);
  assert.match(motivoDoDrive(401), /conectada de novo/);
  assert.match(motivoDoDrive(503), /instável/);
  assert.equal(bytesRecebidos("bytes=0-8388607"), 8388608);
  assert.equal(bytesRecebidos(null), 0);
});
