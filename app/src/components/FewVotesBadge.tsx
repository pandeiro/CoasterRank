import { isFewVotes } from '../lib/coasters'
import { Badge } from './ui'

export default function FewVotesBadge({ comparisons }: { comparisons: number | null }) {
  if (!isFewVotes(comparisons)) return null
  return <Badge tone="warning">few votes</Badge>
}
