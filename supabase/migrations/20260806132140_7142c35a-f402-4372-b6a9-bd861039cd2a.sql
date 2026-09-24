ALTER TABLE public.work_orders
  ALTER COLUMN collection_rule DROP DEFAULT,
  ALTER COLUMN collection_rule DROP NOT NULL;

UPDATE public.work_orders SET collection_rule = NULL WHERE collection_rule = 'split_by_service';