export interface KeepoutZone {
  start: number
  end_num: number
  description: string
}

export interface SerializationSettingsData {
  enabled: boolean
  prefix: string
  suffix: string
  padding_digits: number
  letter_count: number
  current_counter: number
  use_letters_before_numbers: boolean
  letter_prefix: string
  keepout_zones: KeepoutZone[]
  auto_apply_extensions: string[]
  // Tab number settings
  tab_enabled: boolean
  tab_separator: string
  tab_padding_digits: number
  tab_required: boolean
  // Tab character settings
  tab_allow_letters: boolean
  tab_allow_numbers: boolean
  tab_allow_special: boolean
  tab_special_chars: string
  // Auto-format settings
  auto_pad_numbers: boolean
}

export const DEFAULT_SERIALIZATION_SETTINGS: SerializationSettingsData = {
  enabled: true,
  prefix: 'PN-',
  suffix: '',
  padding_digits: 5,
  letter_count: 0,
  current_counter: 0,
  use_letters_before_numbers: false,
  letter_prefix: '',
  keepout_zones: [],
  auto_apply_extensions: [],
  // Tab number settings
  tab_enabled: false,
  tab_separator: '-',
  tab_padding_digits: 3,
  tab_required: false,
  // Tab character settings
  tab_allow_letters: false,
  tab_allow_numbers: true,
  tab_allow_special: false,
  tab_special_chars: '-_',
  // Auto-format settings
  auto_pad_numbers: true,
}
