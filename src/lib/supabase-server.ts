import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Serverns egen Supabase-klient. Finns servicenyckeln (SUPABASE_SERVICE_ROLE_KEY)
// används den så att bakgrundsjobben når böckerna oavsett vem som äger dem.
// Annars används samma anon-nyckel som webbläsaren, precis som idag.
let client: SupabaseClient | null = null;

export function serverSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  // Next cachar fetch-anrop. Utan no-store får bakgrundsjobbet gamla svar
  // (samma uppslag om och om igen, eller en tom kö fast det finns arbete kvar).
  client = createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: 'no-store' }),
    },
  });
  return client;
}

export const hasServiceRole = () => !!process.env.SUPABASE_SERVICE_ROLE_KEY;
export const SERVER_IMAGES_BUCKET = 'barnbok-images';
