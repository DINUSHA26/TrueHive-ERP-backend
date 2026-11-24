-- Enable Row Level Security (RLS) on all tables in public schema for Supabase Security Advisor compliance
DO $$ 
DECLARE 
    r RECORD;
BEGIN 
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') 
    LOOP 
        EXECUTE 'ALTER TABLE public."' || r.tablename || '" ENABLE ROW LEVEL SECURITY;'; 
    END LOOP; 
END $$;

-- Automatically enable RLS on any future tables created in public schema
CREATE OR REPLACE FUNCTION public.pgrst_enable_rls()
RETURNS event_trigger AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag = 'CREATE TABLE' THEN
      EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY;', cmd.object_identity);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

DROP EVENT TRIGGER IF EXISTS enable_rls_on_create_table;
CREATE EVENT TRIGGER enable_rls_on_create_table
ON ddl_command_end
WHEN TAG IN ('CREATE TABLE')
EXECUTE FUNCTION public.pgrst_enable_rls();

