import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

export type Profile = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  active: boolean;
};

/** Garante perfil e permissão de acesso do usuário logado. */
export async function ensureAccess() {
  const { error } = await supabase.rpc("ensure_my_access");
  if (error) throw error;
}

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { session, user: session?.user ?? null, loading };
}

export function useProfile() {
  const { user } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!user) {
      setProfile(null);
      return;
    }
    let mounted = true;
    supabase
      .from("users_profiles")
      .select("id, full_name, email, phone, active")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (mounted) setProfile((data as Profile | null) ?? null);
      });
    return () => {
      mounted = false;
    };
  }, [user]);

  return profile;
}

export function displayName(profile: Profile | null, email?: string | null): string {
  if (profile?.full_name) return profile.full_name;
  if (email) return email.split("@")[0] ?? email;
  return "Usuário";
}
