// Orçamento pela API (PostgREST, como o app): salvo como "enviado" o lead vai para "Orçamento
// enviado"; rascunho não mexe no lead; a proposta (documento sem OS) fica no orçamento sem criar OS
// nem mudar a situação; outra empresa não vê a proposta. Dados fictícios.
import { createHmac } from "node:crypto";
const SECRET = "segredo-de-teste-local-com-mais-de-32-caracteres";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
const U = { turbine: "b", b: "c" };
async function req(user, path, { method = "GET", body } = {}) {
  const r = await fetch(`${process.env.PGRST_URL ?? "http://localhost:3999"}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${jwt(`00000000-0000-0000-0000-00000000000${U[user]}`)}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
let falhas = 0;
function check(nome, cond, info) {
  console.log(`${cond ? "OK  " : "FALHA"} ${nome}${cond ? "" : " -> " + JSON.stringify(info)}`);
  if (!cond) falhas++;
}
const statusDoLead = async (id) =>
  (
    await req(
      "turbine",
      `/crm_leads?id=eq.${id}&select=orcamento_enviado_em,status:status_id(name)`,
    )
  ).body?.[0];

const novo = await req(
  "turbine",
  "/config_options?kind=eq.crm_status&name=eq.Novo%20contato&select=id",
);
const statusNovo = novo.body?.[0]?.id;
check("status 'Novo contato' da Turbine", Boolean(statusNovo), novo);

// Leads do seed (criar lead pela API esbarra na permissão do índice de telefone; ver relatório).
async function lead(nome) {
  const r = await req("turbine", `/crm_leads?lead_name=eq.${encodeURIComponent(nome)}&select=id`);
  return r.body?.[0]?.id;
}

// 1) salvo = enviado: o lead vai para "Orçamento enviado"
const l1 = await lead("Lead API Enviado");
let r = await req("turbine", "/quotes", {
  method: "POST",
  body: {
    cliente_nome: "Lead API Enviado",
    cliente_telefone: "11946000001",
    total: 350,
    status: "enviado",
  },
});
const q1 = r.body?.[0];
check(
  "orçamento enviado criado e ligado ao lead pelo telefone",
  r.status === 201 && q1?.crm_lead_id === l1,
  r,
);
let s = await statusDoLead(l1);
check("lead foi para 'Orçamento enviado'", s?.status?.name === "Orçamento enviado", s);
check("lead com a data de orçamento enviado", Boolean(s?.orcamento_enviado_em), s);

// 2) rascunho não mexe no lead
const l2 = await lead("Lead API Rascunho");
r = await req("turbine", "/quotes", {
  method: "POST",
  body: {
    cliente_nome: "Lead API Rascunho",
    cliente_telefone: "11946000002",
    total: 200,
    status: "rascunho",
  },
});
s = await statusDoLead(l2);
check(
  "rascunho deixa o lead em 'Novo contato'",
  s?.status?.name === "Novo contato" && !s?.orcamento_enviado_em,
  s,
);

// 3) proposta guardada no orçamento: não cria OS nem muda a situação
await req("turbine", `/quotes?id=eq.${q1.id}`, { method: "PATCH", body: { status: "aprovado" } });
r = await req("turbine", `/quotes?id=eq.${q1.id}`, {
  method: "PATCH",
  body: {
    proposta_documento_id: "doc-api",
    proposta_url: "https://docs.google.com/document/d/doc-api",
    proposta_gerada_em: new Date().toISOString(),
  },
});
check(
  "proposta guardada sem mudar a situação nem criar OS",
  r.status === 200 &&
    r.body?.[0]?.status === "aprovado" &&
    r.body?.[0]?.generated_work_order_id === null,
  r,
);
const os = await req("turbine", "/work_orders?select=id");
check("nenhuma OS nova (só a do cadastro inicial)", os.body?.length === 1, os.body?.length);

// 4) outra empresa não vê a proposta
r = await req("b", `/quotes?id=eq.${q1.id}&select=proposta_url`);
check(
  "empresa B não vê o orçamento nem a proposta da Turbine",
  r.status === 200 && r.body?.length === 0,
  r,
);

if (falhas) {
  console.error(`${falhas} falha(s)`);
  process.exit(1);
}
