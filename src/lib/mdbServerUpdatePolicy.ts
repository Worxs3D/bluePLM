export function mdbServerUpdateCheckKey(organizationId: string, serverUrl: string): string {
  return `${organizationId}:${serverUrl}`
}

export function shouldNotifyMdbServerUpdate(status: string, role: string): boolean {
  return (status === 'update-available' || status === 'same-version-different')
    && (role === 'owner' || role === 'admin')
}
