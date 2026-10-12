import { useState } from 'react';

/**
 * Which of a section's two lists is showing: the one with work in it until
 * the person picks one, then whichever they picked. It is derived rather than
 * set once, so it stays right when the records arrive after the screen opens.
 */
export function useWorkList(workId, doneId, hasWork) {
  const [chosen, setChosen] = useState(null);
  return [chosen ?? (hasWork ? workId : doneId), setChosen];
}
