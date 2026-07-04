import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazily-constructed service-role client. Lazy so that importing this module
// (e.g. from a verification harness) does not require live credentials until a
// query is actually issued.
let realClient: SupabaseClient | null = null
let testClient: SupabaseClient | null = null

function getRealClient(): SupabaseClient {
  if (!realClient) {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    }
    realClient = createClient(url, key, { auth: { persistSession: false } })
  }
  return realClient
}

/**
 * Test-only seam: inject an in-memory fake so the route/service/repository
 * stack can be exercised end-to-end without a live Postgres. Pass `null` to
 * restore the real client. Never called from production code paths.
 */
export function __setSupabaseClientForTests(client: SupabaseClient | null): void {
  testClient = client
}

// Exported as a Proxy so all existing `supabase.from(...)` call sites keep
// working unchanged while resolution stays lazy and test-overridable.
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const active = testClient ?? getRealClient()
    const value = Reflect.get(active as object, prop, receiver)
    return typeof value === 'function' ? value.bind(active) : value
  },
})
