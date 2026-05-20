-- Add username for PIN login (synthetic email: username@sosco.local)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_unique
  ON public.profiles (lower(username)) WHERE username IS NOT NULL;

-- Public read of (id, username, full_name) for the login dropdown happens via
-- a server function using the service-role client. We do NOT widen RLS here.