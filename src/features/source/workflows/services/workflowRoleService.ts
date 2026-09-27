import { routeBackend } from '@/lib/backendAdapter'
import { t } from '@/lib/i18n'
import { supabase } from '@/lib/supabase'

import type { WorkflowRoleBasic } from '../types'

/** Load workflow-role choices without exposing provider selection to dialogs. */
export function getWorkflowRoleOptions(organizationId: string): Promise<WorkflowRoleBasic[]> {
  return routeBackend({
    mdb: async () => [
      {
        id: 'admin',
        name: t('mdbSetup.workflowRoleAdministrators'),
        color: '#DC2626',
        icon: 'shield',
      },
      {
        id: 'engineer',
        name: t('mdbSetup.workflowRoleEngineers'),
        color: '#2563EB',
        icon: 'wrench',
      },
      {
        id: 'viewer',
        name: t('mdbSetup.workflowRoleViewers'),
        color: '#64748B',
        icon: 'eye',
      },
    ],
    supabase: async () => {
      const { data, error } = await supabase
        .from('workflow_roles')
        .select('id, name, color, icon')
        .eq('org_id', organizationId)
        .eq('is_active', true)
        .order('sort_order')
        .order('name')

      if (error) throw new Error(error.message)
      return (data ?? []) as WorkflowRoleBasic[]
    },
  })
}
