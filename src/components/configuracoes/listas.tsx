// Seção de Configurações (veio da antiga tela de abas).
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useConfigOptions } from "@/lib/data";

export function Listas() {
  const origens = useConfigOptions("sales_origin", false);
  const servicos = useConfigOptions("service_type", false);
  const estofados = useConfigOptions("upholstery_type", false);

  async function adicionar(kind: string, nome: string, refetch: () => void) {
    if (nome.trim().length < 2) {
      toast.error("Informe um nome válido.");
      return;
    }
    const { error } = await supabase.from("config_options").insert({ kind, name: nome.trim() });
    if (error) {
      toast.error("Não foi possível adicionar o item.");
      return;
    }
    toast.success("Item adicionado.");
    refetch();
  }

  const blocos = [
    { titulo: "Tipos de serviço", kind: "service_type", query: servicos },
    { titulo: "Tipos de estofado", kind: "upholstery_type", query: estofados },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <OrigensBloco
        onAdd={(nome) => adicionar("sales_origin", nome, () => void origens.refetch())}
      />
      {blocos.map((b) => (
        <ListaBloco
          key={b.kind}
          titulo={b.titulo}
          kind={b.kind}
          itens={(b.query.data ?? []).map((o) => o.name)}
          onAdd={(nome) => adicionar(b.kind, nome, () => b.query.refetch())}
        />
      ))}
    </div>
  );
}

type OrigemItem = { id: string; name: string; metadata: Record<string, unknown> | null };

/**
 * Origens do lead com as palavras-chave que o sistema procura na primeira mensagem do cliente
 * (ex.: link de WhatsApp com o texto "Vim pelo Google"). "Cliente existente" é identificado pelo
 * telefone; Instagram/Facebook também pelos dados de anúncio quando o WhatsApp os envia.
 */
function OrigensBloco({ onAdd }: { onAdd: (nome: string) => void }) {
  const query = useQuery({
    queryKey: ["config_options_origens"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("config_options")
        .select("id, name, metadata")
        .eq("kind", "sales_origin")
        .eq("active", true)
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as OrigemItem[];
    },
  });
  const [novo, setNovo] = useState("");

  async function salvarPalavras(item: OrigemItem, texto: string) {
    const palavras = texto
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const { error } = await supabase
      .from("config_options")
      .update({ metadata: { ...(item.metadata ?? {}), palavras } } as never)
      .eq("id", item.id);
    if (error) {
      toast.error("Não foi possível salvar as palavras-chave.");
      return;
    }
    toast.success(`Palavras-chave de ${item.name} salvas.`);
    void query.refetch();
  }

  return (
    <section className="card-surface p-5 lg:col-span-3">
      <h2 className="mb-1 text-lg font-semibold">Origens do lead</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        De onde o cliente veio. O sistema identifica sozinho quando a primeira mensagem contém uma
        das palavras-chave (separe por vírgula). Cliente já cadastrado vira “Cliente existente” pelo
        telefone. O que não for identificado pode ser escolhido na página do lead.
      </p>
      <div className="grid gap-2">
        {(query.data ?? []).map((o) => (
          <OrigemLinha key={o.id} item={o} onSalvar={salvarPalavras} />
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Nova origem" />
        <Button
          variant="outline"
          onClick={() => {
            onAdd(novo);
            setNovo("");
            setTimeout(() => void query.refetch(), 500);
          }}
        >
          Adicionar
        </Button>
      </div>
    </section>
  );
}

function OrigemLinha({
  item,
  onSalvar,
}: {
  item: OrigemItem;
  onSalvar: (item: OrigemItem, texto: string) => void;
}) {
  const meta = item.metadata ?? {};
  const atuais = Array.isArray(meta["palavras"]) ? (meta["palavras"] as string[]).join(", ") : "";
  const [texto, setTexto] = useState(atuais);
  useEffect(() => setTexto(atuais), [atuais]);
  const porTelefone = meta["codigo"] === "cliente_existente";
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[12rem_1fr_auto] sm:items-center">
      <span className="text-sm font-medium">{item.name}</span>
      {porTelefone ? (
        <span className="text-xs text-muted-foreground">
          Identificada pelo telefone de cliente já cadastrado.
        </span>
      ) : (
        <Input
          aria-label={`Palavras-chave de ${item.name}`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Sem palavras-chave (só escolha manual)"
        />
      )}
      {porTelefone ? null : (
        <Button
          variant="outline"
          size="sm"
          disabled={texto === atuais}
          onClick={() => onSalvar(item, texto)}
        >
          Salvar
        </Button>
      )}
    </div>
  );
}

function ListaBloco({
  titulo,
  itens,
  onAdd,
}: {
  titulo: string;
  kind: string;
  itens: string[];
  onAdd: (nome: string) => void;
}) {
  const [novo, setNovo] = useState("");
  return (
    <section className="card-surface p-5">
      <h2 className="mb-3 text-lg font-semibold">{titulo}</h2>
      <ul className="mb-3 space-y-1 text-sm">
        {itens.map((i) => (
          <li key={i} className="rounded-md border border-border px-3 py-2">
            {i}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Novo item" />
        <Button
          variant="outline"
          onClick={() => {
            onAdd(novo);
            setNovo("");
          }}
        >
          Adicionar
        </Button>
      </div>
    </section>
  );
}
