import { test } from "node:test";
import assert from "node:assert/strict";
import { linkWhatsAppConvite, mensagemConvite } from "./convite";

test("mensagem do convite traz empresa, endereço, e-mail e o passo a passo", () => {
  const t = mensagemConvite({
    empresa: "Lava Bem Estofados",
    email: "dono@lavabem.com.br",
    papel: "admin",
    endereco: "https://nexa.exemplo.com/",
  });
  assert.match(t, /empresa Lava Bem Estofados, com o papel Administrador/);
  assert.match(t, /1\. Abra https:\/\/nexa\.exemplo\.com\/auth\n/);
  assert.match(t, /exatamente este e-mail: dono@lavabem\.com\.br/);
  assert.match(t, /Criar conta/);
  assert.match(t, /e-mail de confirmação/);
});

test("papéis e link do WhatsApp", () => {
  const t = mensagemConvite({
    empresa: "X",
    email: "a@b.c",
    papel: "tecnico",
    endereco: "https://n",
  });
  assert.match(t, /o papel Técnico\./);
  const link = linkWhatsAppConvite("Olá & até já\nlinha 2");
  assert.equal(link, "https://wa.me/?text=Ol%C3%A1%20%26%20at%C3%A9%20j%C3%A1%0Alinha%202");
});
