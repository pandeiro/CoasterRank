import { supabase } from './supabase'

export type Profile = {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  is_admin: boolean
  /** Opt-in flag: public rider page at /riders/<username> when true. */
  public_list: boolean
}

/**
 * The single fetch behind the shared `['profile', userId]` query cache entry.
 * Every observer of that key MUST use this function (same SELECT shape): a
 * narrower queryFn under the same key could satisfy other observers with a
 * partial object (e.g. a bare `{ is_admin }`), which previously risked
 * ProfilePage initializing its form from an empty username and saving `null`
 * over it.
 */
export async function fetchProfile(userId: string): Promise<Profile> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, display_name, avatar_url, is_admin, public_list')
    .eq('id', userId)
    .single()
  if (error) throw error
  return data as Profile
}
