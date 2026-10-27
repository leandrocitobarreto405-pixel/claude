// Configurações › Equipe › Contadora: convidar, ver e remover. Ela não conta no limite de usuários
// e vê só Notas fiscais, OS realizadas, Despesas e Exportar mês.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { dateBR } from "@/lib/format";
import { convidarContadoraFn } from "@/lib/convite.functions";

const CHAVE = ["contadoras"];

export function Contadora() {
  const qc = useQueryClient();
  const convidar = useServerFn(convidarContadoraFn);
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const { data } = useQuery({
    queryKey: CHAVE,
    queryFn: async () => {
      const [ativas, convites] = await Promise.all([
        supabase.from("contadoras_empresa").select("id, email, created_at").order("created_at"),
        supabase
          .from("convites_contadora")
          .select("id, email, created_at")
          .is("aceito_em", null)
          .order("created_at"),
      ]);
      if (ativas.error) throw ativas.error;
      if (convites.error) throw convites.error;
      return { ativas: ativas.data ?? [], convites: convites.data ?? [] };
    },
  });

  async function enviar(e: React.FormEvent, reenviar = false, para = email) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await convidar({ data: { email: para, reenviar } });
      toast.success(
        r.envio === "convite_enviado"
          ? "Convite enviado por e-mail."
          : r.envio === "aviso_enviado"
            ? "Ela já tem conta: avisamos por e-mail. O acesso aparece no próximo login."
            : r.envio === "ja_tem_conta"
              ? "Ela já tem conta: o acesso aparece no próximo login."
              : `Convite registrado, mas o e-mail não saiu: ${r.detalhe ?? "tente reenviar"}.`,
      );
      setEmail("");
      await qc.invalidateQueries({ queryKey: CHAVE });
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não foi possível convidar.");
    } finally {
      setEnviando(false);
    }
  }

  async function remover(tabela: "contadoras_empresa" | "convites_contadora", id: string) {
    const { error } = await supabase.from(tabela).delete().eq("id", id);
    if (error) {
      toast.error("Não foi possível remover.");
      return;
    }
    toast.success(tabela === "contadoras_empresa" ? "Acesso removido." : "Convite cancelado.");
    await qc.invalidateQueries({ queryKey: CHAVE });
  }

  return (
    <section className="card-surface space-y-4 p-5" aria-label="Contadora">
      <div>
        <h2 className="text-lg font-semibold">Contadora</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Vê só Notas fiscais, OS realizadas, Despesas e Exportar mês. Não vê conversas, leads,
          orçamentos nem comissões, e não conta no limite de usuários do plano.
        </p>
      </div>
      <form onSubmit={(e) => enviar(e)} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="email-contadora">E-mail da contadora</Label>
          <Input
            id="email-contadora"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="contadora@escritorio.com.br"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={enviando || !email.trim()}>
          {enviando ? "Enviando…" : "Convidar contadora"}
        </Button>
      </form>
      {data && (data.ativas.length > 0 || data.convites.length > 0) ? (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {data.ativas.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <span>
                <span className="font-medium">{c.email}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · com acesso desde {dateBR(c.created_at)}
                </span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => remover("contadoras_empresa", c.id)}>
                Remover acesso
              </Button>
            </li>
          ))}
          {data.convites.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <span>
                <span className="font-medium">{c.email}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · convite de {dateBR(c.created_at)}, ainda não entrou
                </span>
              </span>
              <span className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => enviar(e as never, true, c.email)}
                >
                  Reenviar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remover("convites_contadora", c.id)}
                >
                  Cancelar
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
