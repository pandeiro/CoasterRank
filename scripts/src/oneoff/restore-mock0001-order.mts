import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

config({ path: new URL('../../../.env', import.meta.url).pathname })

const ORIGINAL = [
  'Steel Vengeance', 'VelociCoaster', 'Pantherian', 'Fury 325', 'Maverick', 'The Voyage',
  'Lightning Rod', 'Iron Gwazi', 'Xcelerator', "Hagrid's Magical Creatures Motorbike Adventure",
  'Iron Rattler', 'Mako', 'Thunder Striker', 'Twisted Colossus', 'Top Thrill 2', 'RailBlazer',
  'Wonder Woman Flight of Courage', 'GhostRider', 'HangTime', 'Gold Striker', 'X2',
]

const url = process.env.VITE_SUPABASE_URL
const anon = process.env.VITE_SUPABASE_ANON_KEY
if (!url || !anon) throw new Error('missing supabase env')

const supabase = createClient(url, anon)
const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
  email: 'mock-0001@test.coasterrank.dev',
  password: 'testride-password',
})
if (authErr || !auth.user) throw authErr

const { data: rides, error: rideErr } = await supabase
  .from('user_rides')
  .select('coaster_id, rank, coasters(name)')
if (rideErr) throw rideErr

const byName = new Map(rides.map((r) => [r.coasters.name, r.coaster_id]))
const missing = ORIGINAL.filter((n) => !byName.has(n))
if (missing.length) throw new Error('missing coasters: ' + missing.join(', '))
const extra = rides.filter((r) => !ORIGINAL.includes(r.coasters.name))
if (extra.length) throw new Error('unexpected rides: ' + extra.map((r) => r.coasters.name).join(', '))

const ranks = ORIGINAL.map((name, i) => ({
  user_id: auth.user.id,
  coaster_id: byName.get(name),
  rank: i + 1,
  ridden: true,
}))

const { error: upErr } = await supabase
  .from('user_rides')
  .upsert(ranks, { onConflict: 'user_id,coaster_id' })
if (upErr) throw upErr
console.log('restored', ranks.length, 'rides to original order for', auth.user.email)
