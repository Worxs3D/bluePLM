import { routeBackend } from './backendAdapter'
import {
  getMdbTeams,
  getMdbOrganizationSetting,
  setMdbOrganizationSetting,
  type MdbOrganizationSettingSection,
} from './mdb'
import { supabase } from './supabase'

export type OrganizationSettingSection = MdbOrganizationSettingSection

export interface OrganizationTeamModuleSummary {
  id: string
  name: string
  color: string
  icon: string
  module_defaults: Record<string, unknown> | null
  member_count: number
}

export async function getTeamsWithModuleDefaults(): Promise<OrganizationTeamModuleSummary[]> {
  return routeBackend({
    mdb: async () => (await getMdbTeams()).filter((team) => team.module_defaults).map((team) => ({
      id: team.id, name: team.name, color: team.color, icon: team.icon,
      module_defaults: team.module_defaults ?? null, member_count: team.memberCount,
    })),
    supabase: async () => {
      const { data, error } = await supabase.from('teams').select('id,name,color,icon,module_defaults,team_members(count)').order('name')
      if (error) throw error
      return (data ?? []).filter((team: any) => team.module_defaults).map((team: any) => ({
        id: team.id, name: team.name, color: team.color, icon: team.icon,
        module_defaults: team.module_defaults, member_count: team.team_members?.[0]?.count ?? 0,
      }))
    },
  })
}

const directColumns: Record<Exclude<OrganizationSettingSection, 'export'>, string> = {
  serialization: 'serialization_settings',
  rfq: 'rfq_settings',
  'auth-providers': 'auth_providers',
  modules: 'module_defaults',
}

export async function getOrganizationSetting<T extends object>(
  section: OrganizationSettingSection,
  organizationId: string,
): Promise<T> {
  return routeBackend({
    mdb: () => getMdbOrganizationSetting<T>(section),
    supabase: async () => {
      if (section === 'export') {
        const { data, error } = await supabase
          .from('organizations')
          .select('settings')
          .eq('id', organizationId)
          .single()
        if (error) throw error
        const settings = data?.settings
        if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {} as T
        const value = (settings as Record<string, unknown>).export_settings
        return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : ({} as T)
      }

      const column = directColumns[section]
      const { data, error } = await (supabase.from('organizations') as any)
        .select(column)
        .eq('id', organizationId)
        .single()
      if (error) throw error
      const value = data?.[column]
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as T) : ({} as T)
    },
  })
}

export async function setOrganizationSetting<T extends object>(
  section: OrganizationSettingSection,
  organizationId: string,
  value: T,
  options: { replaceCounter?: boolean; force?: boolean } = {},
): Promise<T> {
  return routeBackend({
    mdb: () => setMdbOrganizationSetting(section, value, options),
    supabase: async () => {
      if (section === 'serialization') {
        const { error } = await (supabase.rpc as any)('update_serialization_settings_safe', {
          p_org_id: organizationId,
          p_settings: JSON.parse(JSON.stringify(value)),
        })
        if (error) throw error
        return value
      }

      if (section === 'export') {
        const { data: organization, error: readError } = await supabase
          .from('organizations')
          .select('settings')
          .eq('id', organizationId)
          .single()
        if (readError) throw readError
        const current =
          organization?.settings &&
          typeof organization.settings === 'object' &&
          !Array.isArray(organization.settings)
            ? organization.settings
            : {}
        const { error } = await (supabase.from('organizations') as any)
          .update({ settings: { ...current, export_settings: value } })
          .eq('id', organizationId)
        if (error) throw error
        return value
      }

      const column = directColumns[section]
      const { error } = await (supabase.from('organizations') as any)
        .update({ [column]: value })
        .eq('id', organizationId)
      if (error) throw error
      return value
    },
  })
}
