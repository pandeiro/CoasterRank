-- Hotfix: PostgREST resolves `profiles!submitted_by(...)` / `profiles:author_id(...)`
-- embeds only across a DIRECT FK to profiles. user_feedback.submitted_by and
-- user_feedback_replies.author_id referenced auth.users only, so every
-- getMyFeedback()/getFeedbackThreads() select failed with "relationship not
-- found" (PGRST200) — rows were written fine but invisible in the SPA.
-- Same fix coaster_submissions needed: 20260828130000_submission_profiles_fk.sql.
-- Both columns reference auth.users(id), so the values are compatible.

ALTER TABLE public.user_feedback
  ADD CONSTRAINT user_feedback_submitter_fkey
  FOREIGN KEY (submitted_by) REFERENCES public.profiles(id);

ALTER TABLE public.user_feedback_replies
  ADD CONSTRAINT user_feedback_replies_author_fkey
  FOREIGN KEY (author_id) REFERENCES public.profiles(id);
