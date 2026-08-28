-- Add FK from coaster_submissions.submitted_by to profiles(id) so PostgREST
-- can resolve the embed in getPendingSubmissions().
-- Both columns reference auth.users(id), so the values are compatible.
ALTER TABLE public.coaster_submissions
  ADD CONSTRAINT submissions_submitter_fkey
  FOREIGN KEY (submitted_by) REFERENCES public.profiles(id);

-- Allow admins to read all profiles (needed for the embed above;
-- non-admins only see their own row via the existing "profiles own select" policy).
CREATE POLICY "profiles admin select"
  ON public.profiles FOR SELECT
  USING (public.is_admin());
