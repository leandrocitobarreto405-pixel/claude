CREATE TABLE public.os_drive_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  materials_folder_id text,
  materials_folder_url text,
  before_folder_id text,
  after_folder_id text,
  videos_folder_id text,
  internal_folder_id text,
  folder_year text NOT NULL,
  folder_month text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_order_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.os_drive_folders TO authenticated;
GRANT ALL ON public.os_drive_folders TO service_role;
ALTER TABLE public.os_drive_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Empresa gerencia pastas das OSs"
ON public.os_drive_folders FOR ALL TO authenticated
USING (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())))
WITH CHECK (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())));
CREATE INDEX idx_os_drive_folders_empresa ON public.os_drive_folders(empresa_id);
CREATE TRIGGER trg_os_drive_folders_upd BEFORE UPDATE ON public.os_drive_folders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.os_drive_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  work_order_id uuid NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  folder_id uuid NOT NULL REFERENCES public.os_drive_folders(id) ON DELETE CASCADE,
  destination text NOT NULL CHECK (destination IN ('Antes', 'Depois', 'Vídeos', 'Controle interno')),
  google_file_id text NOT NULL,
  google_file_url text,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size >= 0),
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.os_drive_files TO authenticated;
GRANT ALL ON public.os_drive_files TO service_role;
ALTER TABLE public.os_drive_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Empresa gerencia arquivos das OSs"
ON public.os_drive_files FOR ALL TO authenticated
USING (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())))
WITH CHECK (empresa_id IN (SELECT public.empresas_do_usuario(auth.uid())));
CREATE INDEX idx_os_drive_files_work_order ON public.os_drive_files(work_order_id, created_at DESC);
CREATE INDEX idx_os_drive_files_empresa ON public.os_drive_files(empresa_id);