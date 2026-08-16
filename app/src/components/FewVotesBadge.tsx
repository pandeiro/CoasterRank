import { isFewVotes } from '../lib/coasters'

export default function FewVotesBadge({ comparisons }: { comparisons: number | null }) {
  if (!isFewVotes(comparisons)) return null
  return (
    <span className="inline-block rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
      few votes
    </span>
  )
}
