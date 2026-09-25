ALTER TABLE public.os_drive_folders
  ADD COLUMN IF NOT EXISTS customer_shared_email TEXT,
  ADD COLUMN IF NOT EXISTS folder_name TEXT;