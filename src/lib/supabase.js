import { createClient } from '@supabase/supabase-js'

const envUrl = import.meta.env.VITE_SUPABASE_URL
const envAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const isConfigured = Boolean(envUrl) && envUrl !== 'your_project_url' && Boolean(envAnonKey) && envAnonKey !== 'your_anon_key'

if (!isConfigured) {
  console.warn(
    'Supabase is not configured yet. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env — see README.md.',
  )
}

// Falls back to a syntactically valid placeholder URL so createClient doesn't
// throw before real credentials are provided; requests will simply fail until then.
export const supabase = createClient(
  isConfigured ? envUrl : 'https://placeholder.supabase.co',
  isConfigured ? envAnonKey : 'placeholder-anon-key',
)
