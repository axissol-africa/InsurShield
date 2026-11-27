/** Accept either RecordingLogger lines or the first argument captured by a Logger spy. */
export function readApiFailureRecords(messages: readonly unknown[], correlationId: string): Record<string, unknown>[] {
  expect(correlationId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  return messages.flatMap((message) => {
    if (typeof message !== 'string') return [];
    const match = /^(?:(?:warn|error) )?(\{.*\})(?:\s+Api)?\s*$/.exec(message);
    if (!match) return [];
    const parsed: unknown = JSON.parse(match[1]);
    if (typeof parsed !== 'object' || parsed === null || !('event' in parsed) || parsed.event !== 'http.request.failed' ||
        !('correlationId' in parsed) || parsed.correlationId !== correlationId) return [];
    return [parsed];
  });
}
