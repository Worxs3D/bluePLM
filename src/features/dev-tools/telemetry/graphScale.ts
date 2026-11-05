export function getTelemetryTimeAxisX(
  timestamp: number,
  now: number,
  retentionSeconds: number,
  width: number,
): number {
  const retentionMs = retentionSeconds * 1000
  return ((timestamp - (now - retentionMs)) / retentionMs) * width
}
