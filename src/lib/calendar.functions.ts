import { createServerFn } from "@tanstack/react-start";
import { requireAdminEmpresa, requireEmpresa } from "@/lib/empresa.middleware";

export type CalendarStatus = {
  enabled: boolean;
  calendarId: string;
  durationMinutes: number;
  hasConnection: boolean;
};

export const getCalendarSettings = createServerFn({ method: "GET" })
  .middleware([requireEmpresa])
  .handler(async (): Promise<CalendarStatus> => {
    const { readSettings } = await import("@/lib/calendar.server");
    const s = await readSettings();
    return { ...s, hasConnection: Boolean(process.env["GOOGLE_CALENDAR_API_KEY"]) };
  });

export const saveCalendarSettings = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .inputValidator(
    (input: { enabled: boolean; calendarId: string; durationMinutes: number }) => input,
  )
  .handler(async ({ data }) => {
    const { saveSettings } = await import("@/lib/calendar.server");
    return saveSettings(data);
  });

export const testCalendarIntegration = createServerFn({ method: "POST" })
  .middleware([requireAdminEmpresa])
  .handler(async () => {
    const { testIntegration } = await import("@/lib/calendar.server");
    return testIntegration();
  });

export const syncVisitEvent = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { visitId: string; kind: "visit" | "budget" }) => input)
  .handler(async ({ data }) => {
    const { syncEvent } = await import("@/lib/calendar.server");
    return syncEvent(data.kind, data.visitId);
  });

export const cancelVisitEvent = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator((input: { visitId: string; kind: "visit" | "budget" }) => input)
  .handler(async ({ data }) => {
    const { cancelEventForVisit } = await import("@/lib/calendar.server");
    return cancelEventForVisit(data.kind, data.visitId);
  });

export const rescheduleVisitEvent = createServerFn({ method: "POST" })
  .middleware([requireEmpresa])
  .inputValidator(
    (input: { previousVisitId: string; newVisitId: string; kind: "visit" | "budget" }) => input,
  )
  .handler(async ({ data }) => {
    const { rescheduleEvent } = await import("@/lib/calendar.server");
    return rescheduleEvent(data.kind, data.previousVisitId, data.newVisitId);
  });
