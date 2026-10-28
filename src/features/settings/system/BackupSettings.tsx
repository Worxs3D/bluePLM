import { usePDMStore } from '@/stores/pdmStore'
import { useShallow } from 'zustand/react/shallow'
import { BackupPanel } from '@/features/source/backup'

export function BackupSettings() {
  const { getEffectiveRole } = usePDMStore(
    useShallow((s) => ({
      getEffectiveRole: s.getEffectiveRole,
    })),
  )

  return (
    <div className="h-full -m-6">
      <div className="h-full p-6">
        <BackupPanel isAdmin={getEffectiveRole() === 'admin'} />
      </div>
    </div>
  )
}
