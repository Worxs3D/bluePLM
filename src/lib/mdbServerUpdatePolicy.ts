export function mdbServerUpdateCheckKey(organizationId: string, serverUrl: string): string {
  return `${organizationId}:${serverUrl}`
}

export function shouldNotifyMdbServerUpdate(status: string, role: string): boolean {
  return (status === 'update-available' || status === 'same-version-different')
    && (role === 'owner' || role === 'admin')
}

export async function finalizeMdbServerUpdateResult(
  result: { success: boolean },
  refreshCapabilities: () => Promise<unknown>,
): Promise<boolean> {
  if (!result.success) return false
  try {
    await refreshCapabilities()
  } catch {
    // Deployment already succeeded. A transient follow-up probe must not turn it into a false failure.
  }
  return true
}
