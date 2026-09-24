import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { statusMeta } from "@/lib/crm";

/** Select nativo — evita as travas de menus flutuantes já observadas no app. */
export function NativeSelect({
  value,
  onChange,
  options,
  placeholder = "Selecione",
  disabled,
  className,
  id,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

const COLOR_CLASSES: Record<string, string> = {
  navy: "bg-navy/10 text-navy border-navy/20",
  teal: "bg-primary/12 text-primary border-primary/25",
  success: "bg-emerald-500/12 text-emerald-700 border-emerald-500/25",
  warning: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  danger: "bg-destructive/12 text-destructive border-destructive/25",
};

export function StatusPill({
  status,
}: {
  status: { name: string; metadata?: unknown } | null | undefined;
}) {
  if (!status) return <span className="text-xs text-muted-foreground">Sem status</span>;
  const meta = statusMeta(status);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        COLOR_CLASSES[meta.color] ?? COLOR_CLASSES["navy"],
      )}
    >
      {status.name}
    </span>
  );
}

export function TemperatureBadge({
  temperature,
  suggested,
}: {
  temperature: string;
  suggested?: boolean;
}) {
  const hot = temperature === "QUENTE";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        hot ? COLOR_CLASSES["danger"] : COLOR_CLASSES["teal"],
      )}
      title={suggested ? "Classificação sugerida pela IA — confirme para fixar" : undefined}
    >
      {hot ? "Quente" : "Frio"}
      {suggested ? <span className="opacity-70">(IA)</span> : null}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  hint,
  accent = "teal",
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  accent?: "teal" | "navy" | "success" | "warning" | "danger";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="card-surface flex items-start gap-3 p-4">
      {Icon ? (
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-lg border",
            COLOR_CLASSES[accent] ?? COLOR_CLASSES["teal"],
          )}
        >
          <Icon className="size-4" />
        </span>
      ) : null}
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-xl font-semibold text-navy">{value}</p>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      </div>
    </div>
  );
}

export function LeadLink({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <Link
      to="/crm/lead/$leadId"
      params={{ leadId: id }}
      className="font-medium text-navy underline-offset-2 hover:text-primary hover:underline"
    >
      {children}
    </Link>
  );
}

export function InfoBadge({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="outline" className="font-normal">
      {children}
    </Badge>
  );
}
