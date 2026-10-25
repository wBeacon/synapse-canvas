export function compactSession(session, limit) {
  const compact = event => event == null ? event : {
    ...event, text: event.text?.slice(0, limit), truncated: event.text?.length > limit,
  }
  return { ...session, turns: session.turns.map(turn => ({
    ...turn, question: compact(turn.question), answer: compact(turn.answer), error: compact(turn.error),
    answers: limit > 2000 ? turn.answers.map(compact) : [],
  })) }
}
