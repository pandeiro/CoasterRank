// Wipes the bench project's user data so every grid point starts from a
// known state: deletes ALL non-admin users (bench, testride, and the real
// users restored from the backup — staging only!) which cascades to
// profiles/user_rides/submissions, then clears derived rating tables.
import type { Pool } from 'pg'

export interface ResetResult {
  usersDeleted: number
}

export async function resetBenchData(pool: Pool): Promise<ResetResult> {
  const client = await pool.connect()
  try {
    const countRes = await client.query<{ count: string }>(
      `select count(*)::text as count from auth.users u
       where not exists (
         select 1 from public.profiles p where p.id = u.id and p.is_admin
       )`,
    )
    const usersDeleted = Number.parseInt(countRes.rows[0]?.count ?? '0', 10)
    // Reviewed submissions keep reviewed_by → FK without cascade; null them.
    await client.query(
      `update public.coaster_submissions set reviewed_by = null
       where reviewed_by is not null and not exists (
         select 1 from public.profiles p where p.id = reviewed_by and p.is_admin
       )`,
    )
    await client.query(
      `delete from auth.users u where not exists (
         select 1 from public.profiles p where p.id = u.id and p.is_admin
       )`,
    )
    await client.query('truncate public.coaster_ratings')
    await client.query('truncate public.rank_weekly_snapshots')
    return { usersDeleted }
  } finally {
    client.release()
  }
}
