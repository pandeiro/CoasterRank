import { supabase } from './supabase'

export type FeedbackCategory = 'bug' | 'confusing' | 'missing' | 'idea'
export type FeedbackStatus = 'open' | 'replied' | 'closed'

/** One entry per picker option in the modal, in display order. */
export const FEEDBACK_CATEGORIES: Array<{
  value: FeedbackCategory
  emoji: string
  label: string
}> = [
  { value: 'bug', emoji: '🐛', label: "Something's broken" },
  { value: 'confusing', emoji: '😕', label: "Something's confusing" },
  { value: 'missing', emoji: '➕', label: 'Missing coaster/data' },
  { value: 'idea', emoji: '💡', label: 'I have an idea' },
]

export const FEEDBACK_MESSAGE_MAX = 2000
/** Open threads allowed per user (mirrors SUBMISSION_PENDING_CAP; RLS mirrors it too). */
export const FEEDBACK_OPEN_CAP = 5

/**
 * Auto-captured silently with every submission (page, browser/device, screen).
 * Intentionally not shown in the UI — it exists so the admin panel has enough
 * context to reproduce a report without asking the user.
 */
export type FeedbackContext = {
  page: string
  user_agent: string
  screen: string
  language: string
  coaster_slug: string | null
}

export type FeedbackReply = {
  id: string
  feedback_id: string
  author_id: string
  message: string
  created_at: string
  profiles?: { id: string; username: string | null; is_admin: boolean } | null
}

export type UserFeedback = {
  id: string
  category: FeedbackCategory
  message: string
  context: Partial<FeedbackContext>
  submitted_by: string
  status: FeedbackStatus
  seen_by_submitter_at: string | null
  created_at: string
  /** Submitter embed (admin queue only). */
  profiles?: { id: string; avatar_url: string | null; username: string | null } | null
  replies?: FeedbackReply[]
}

/**
 * Snapshot of the current page/device at submit time. Coaster pages pass
 * their slug so the admin panel can link straight to the ride in question.
 */
export function buildFeedbackContext(coasterSlug: string | null): FeedbackContext {
  return {
    page: `${window.location.pathname}${window.location.search}`,
    user_agent: navigator.userAgent,
    screen: `${window.screen.width}x${window.screen.height}`,
    language: navigator.language,
    coaster_slug: coasterSlug,
  }
}

export function validateFeedbackMessage(message: string): string | null {
  const trimmed = message.trim()
  if (trimmed.length < 1) return 'Tell us a little about it first.'
  if (trimmed.length > FEEDBACK_MESSAGE_MAX) {
    return `Keep it under ${FEEDBACK_MESSAGE_MAX} characters.`
  }
  return null
}

export function validateFeedbackCategory(category: FeedbackCategory | null): string | null {
  if (!category) return 'Pick what this is about.'
  return null
}

export async function submitFeedback(data: {
  category: FeedbackCategory
  message: string
  context: FeedbackContext
}) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')

  // Schema chokepoint mirroring submitCoaster: the form-level check keeps the
  // modal friendly; this keeps hostile/buggy clients from landing rows the
  // DB CHECK would reject (or that an admin cannot act on).
  const error = validateFeedbackCategory(data.category) ?? validateFeedbackMessage(data.message)
  if (error) throw new Error(error)

  const { data: feedback, error: insertError } = await supabase
    .from('user_feedback')
    .insert({
      category: data.category,
      message: data.message.trim(),
      context: data.context,
      submitted_by: user.id,
    })
    .select()
    .single()
  if (insertError) throw insertError
  return feedback as UserFeedback
}

/** Admin-only view: profiles embeds resolve for admins (they can read all profiles). */
const REPLY_EMBED = 'profiles:author_id(id, username, is_admin)'

/**
 * The caller's own feedback threads with their reply histories (RLS filters
 * selects to submitted_by = uid for non-admins), newest first. Reply embeds
 * are ordered oldest→newest so threads read like a conversation. Deliberately
 * NO profiles embed on replies: profiles have no public-select policy, so a
 * submitter cannot read an admin's profile row (the embed would come back
 * null) — reply authorship is derived client-side instead (see
 * hasUnseenAdminReply / the modal's reply labels).
 */
export async function getMyFeedback(): Promise<UserFeedback[]> {
  const { data, error } = await supabase
    .from('user_feedback')
    .select('*, replies:user_feedback_replies(id, feedback_id, author_id, message, created_at)')
    .order('created_at', { ascending: false })
    .order('created_at', { referencedTable: 'user_feedback_replies', ascending: true })
    .range(0, 99)
  if (error) throw error
  return data as UserFeedback[]
}

/** Admin view: every thread, newest first. */
export async function getFeedbackThreads(): Promise<UserFeedback[]> {
  const { data, error } = await supabase
    .from('user_feedback')
    .select(
      `*, profiles!submitted_by(id, avatar_url, username), replies:user_feedback_replies(id, feedback_id, author_id, message, created_at, ${REPLY_EMBED})`,
    )
    .order('created_at', { ascending: false })
    .order('created_at', { referencedTable: 'user_feedback_replies', ascending: true })
    .range(0, 199)
  if (error) throw error
  return data as UserFeedback[]
}

export async function replyToFeedback(feedbackId: string, message: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')

  const validationError = validateFeedbackMessage(message)
  if (validationError) throw new Error(validationError)

  const { data: reply, error } = await supabase
    .from('user_feedback_replies')
    .insert({
      feedback_id: feedbackId,
      author_id: user.id,
      message: message.trim(),
    })
    .select()
    .single()
  if (error) throw error
  return reply as FeedbackReply
}

/** Admin-only via RLS: close a thread or reopen a closed one. */
export async function setFeedbackStatus(id: string, status: FeedbackStatus) {
  const { error } = await supabase.from('user_feedback').update({ status }).eq('id', id)
  if (error) throw error
}

/**
 * Clears the "New" pill state on the caller's threads (security-definer RPC;
 * submitters have no UPDATE grant). Safe to call on every modal open.
 */
export async function markMyFeedbackSeen() {
  const { error } = await supabase.rpc('mark_own_feedback_seen')
  if (error) throw error
}

/**
 * True when the thread carries an admin reply the submitter hasn't seen.
 * The replies insert policy guarantees every author other than the submitter
 * is an admin, so authorship alone identifies team replies (no profiles
 * embed needed — see getMyFeedback).
 */
export function hasUnseenAdminReply(feedback: UserFeedback): boolean {
  const seenAt = feedback.seen_by_submitter_at
  return (feedback.replies ?? []).some(
    (reply) => reply.author_id !== feedback.submitted_by && (!seenAt || reply.created_at > seenAt),
  )
}
