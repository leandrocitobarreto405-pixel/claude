// Consultas com tabelas embutidas pela API (PostgREST, como o app): as do Início, do DRE e do
// painel Nexa › Alice respondem 200; sem dizer a chave de visits o PostgREST recusa (o erro que
// zerou o Início em 19/10). Dados fictícios do seed.
import { createHmac } from "node:crypto";
import {
  SELECT_LEADS_ALICE_NEXA,
  SELECT_OS_DRE,
  SELECT_OS_PAINEL,
} from "../../../src/lib/consultas";

const SECRET = "segredo-de-teste-local-com-mais-de-32-caracteres";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub: string) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const p = b64({ sub, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600 });
  return `${h}.${p}.${createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
// Como o supabase-js: tira os espaços fora de aspas antes de mandar o select.
const comoOApp = (select: string) => select.replace(/\s+/g, "");
async function get(tabela: string, select: string) {
  const r = await fetch(
    `${process.env.PGRST_URL ?? "http://localhost:3999"}/${tabela}?select=${encodeURIComponent(comoOApp(select))}&limit=5`,
    { headers: { Authorization: `Bearer ${jwt("00000000-0000-0000-0000-00000000000b")}` } },
  );
  return { status: r.status, body: (await r.json().catch(() => null)) as unknown };
}
let falhas = 0;
function check(nome: string, cond: boolean, info?: unknown) {
  console.log(`${cond ? "OK  " : "FALHA"} ${nome}${cond ? "" : " -> " + JSON.stringify(info)}`);
  if (!cond) falhas++;
}

for (const [nome, tabela, select] of [
  ["Início (vendas com repasse)", "work_orders", SELECT_OS_PAINEL],
  ["DRE (OS com repasse)", "work_orders", SELECT_OS_DRE],
  ["Nexa › Alice (leads com OS e repasse)", "crm_leads", SELECT_LEADS_ALICE_NEXA],
] as const) {
  const r = await get(tabela, select);
  check(`${nome}: responde 200`, r.status === 200 && Array.isArray(r.body), r);
}

// A armadilha existe: sem a chave, o mesmo embutido é recusado (PGRST201).
const ambiguo = await get("work_orders", "id, visits ( repasse_parceiro )");
check(
  "sem a chave de visits o PostgREST recusa (more than one relationship)",
  ambiguo.status === 300 && JSON.stringify(ambiguo.body).includes("PGRST201"),
  ambiguo,
);

if (falhas) {
  console.error(`${falhas} falha(s)`);
  process.exit(1);
}
