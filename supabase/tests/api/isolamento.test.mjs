import { createHmac } from "node:crypto";
const SECRET = "segredo-de-teste-local-com-mais-de-32-caracteres";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
const U = { nexa: "a", turbine: "b", b: "c", multi: "d" };
const EMP = {
  turbine: "11111111-1111-1111-1111-111111111111",
  b: "22222222-2222-2222-2222-222222222222",
};
async function req(user, path, { empresa, method = "GET", body } = {}) {
  const headers = {
    Authorization: `Bearer ${jwt(`00000000-0000-0000-0000-00000000000${U[user]}`)}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (empresa) headers["x-empresa-id"] = empresa;
  const r = await fetch(`${process.env.PGRST_URL ?? "http://localhost:3999"}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
let falhas = 0;
function check(nome, cond, info) {
  console.log(`${cond ? "OK  " : "FALHA"} ${nome}${cond ? "" : " -> " + JSON.stringify(info)}`);
  if (!cond) falhas++;
}
const nomes = (r) =>
  (r.body ?? [])
    .map((c) => c.full_name)
    .sort()
    .join(",");

let r = await req("turbine", "/customers?select=full_name");
check("Turbine sem cabeçalho vê só a Turbine", nomes(r) === "Cliente da Turbine", r);
r = await req("b", "/customers?select=full_name");
check("B vê só B", nomes(r) === "Cliente de B", r);
r = await req("b", "/customers?select=full_name", { empresa: EMP.turbine });
check("B com cabeçalho forjado não vê nada", r.status === 200 && nomes(r) === "", r);
r = await req("multi", "/customers?select=full_name");
check("Usuário com 2 empresas sem cabeçalho não vê nada", nomes(r) === "", r);
r = await req("multi", "/customers?select=full_name", { empresa: EMP.b });
check("Usuário com 2 empresas + cabeçalho B vê só B", nomes(r) === "Cliente de B", r);
r = await req("nexa", "/customers?select=full_name", { empresa: EMP.turbine });
check("Nexa dentro da Turbine vê só a Turbine", nomes(r) === "Cliente da Turbine", r);
r = await req("turbine", "/work_orders?select=os_number,customer:customer_id(full_name)");
check(
  "Consulta embutida (customer:customer_id) funciona",
  r.status === 200 && r.body?.[0]?.customer?.full_name === "Cliente da Turbine",
  r,
);
r = await req("b", "/customers", { method: "POST", body: { full_name: "Novo de B", phone: "3" } });
check(
  "Inserção sem empresa_id grava na empresa ativa",
  r.status === 201 && r.body?.[0]?.empresa_id === EMP.b,
  r,
);
r = await req("multi", "/rpc/empresa_ativa", { method: "POST", body: {}, empresa: EMP.turbine });
check("RPC empresa_ativa lê o cabeçalho", r.body === EMP.turbine, r);
r = await req("nexa", "/empresas?select=nome&order=nome");
check("Nexa lista todas as empresas", (r.body ?? []).length === 2, r);
process.exit(falhas ? 1 : 0);
