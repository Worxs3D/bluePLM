import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Dialog } from '@/components/core/Dialog'
import { updateCommunityUser } from '@/lib/community'
import { usePDMStore } from '@/stores/pdmStore'
import type { OrgUser } from '../../types'

interface EditCommunityUserCredentialsDialogProps {
  user: OrgUser
  onClose: () => void
  onUpdated: () => Promise<void> | void
}

/**
 * Community-only account editor. Credentials are deliberately kept outside of
 * the Supabase invitation/profile flow so a Community installation never
 * needs a Supabase session or API key to manage its users.
 */
export function EditCommunityUserCredentialsDialog({
  user,
  onClose,
  onUpdated,
}: EditCommunityUserCredentialsDialogProps) {
  const { addToast } = usePDMStore()
  const [email, setEmail] = useState(user.email)
  const [displayName, setDisplayName] = useState(user.full_name ?? '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async () => {
    const normalizedEmail = email.trim().toLowerCase()
    const normalizedName = displayName.trim()

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      addToast('error', 'Enter a valid email address')
      return
    }
    if (normalizedName.length < 2) {
      addToast('error', "Enter the user's full name")
      return
    }
    if (password && password.length < 12) {
      addToast('error', 'The new password must have at least 12 characters')
      return
    }
    if (password !== confirmPassword) {
      addToast('error', 'The passwords do not match')
      return
    }

    const changed =
      normalizedEmail !== user.email.toLowerCase() ||
      normalizedName !== (user.full_name ?? '').trim() ||
      password.length > 0
    if (!changed) {
      onClose()
      return
    }

    setIsSaving(true)
    try {
      await updateCommunityUser(user.id, {
        email: normalizedEmail,
        displayName: normalizedName,
        ...(password ? { password } : {}),
      })
      await onUpdated()
      addToast('success', `Updated account for ${normalizedName}`)
      onClose()
    } catch (error) {
      addToast('error', error instanceof Error ? error.message : 'Failed to update user account')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open onClose={isSaving ? () => undefined : onClose} title="Edit Community account">
      <div className="space-y-4">
        <p className="text-sm text-plm-fg-muted">
          Changing an email address or password ends this user&apos;s active sessions. They will
          sign in again with the new credentials.
        </p>
        <label className="block text-sm text-plm-fg">
          Full name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            disabled={isSaving}
            className="input mt-1 w-full"
            autoComplete="name"
          />
        </label>
        <label className="block text-sm text-plm-fg">
          Email address
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={isSaving}
            className="input mt-1 w-full"
            type="email"
            autoComplete="email"
          />
        </label>
        <label className="block text-sm text-plm-fg">
          New password <span className="text-plm-fg-muted">(leave blank to keep)</span>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSaving}
            className="input mt-1 w-full"
            type="password"
            autoComplete="new-password"
          />
        </label>
        <label className="block text-sm text-plm-fg">
          Confirm new password
          <input
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            disabled={isSaving || !password}
            className="input mt-1 w-full"
            type="password"
            autoComplete="new-password"
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={isSaving} className="btn btn-secondary">
            Cancel
          </button>
          <button onClick={() => void handleSave()} disabled={isSaving} className="btn btn-primary">
            {isSaving && <Loader2 size={15} className="animate-spin" />}
            Save account
          </button>
        </div>
      </div>
    </Dialog>
  )
}
