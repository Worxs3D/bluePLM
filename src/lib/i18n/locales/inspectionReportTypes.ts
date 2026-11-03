/**
 * English strings of inspection report types (5.6.0, schema 506), spread into `source.inspection`
 * in `en.ts` next to `inspectionReportStrings` (an English-only namespace: other locales fall back
 * per key). `inspectionReportKeys.test.ts` checks that every type, FAI reason, selection note and
 * sampling error has its key.
 */
export const inspectionReportTypeStrings: Record<string, string> = {
  // Type names (also printed in the workbook as {{REPORT_TYPE}})
  rptType_fai: 'First article inspection',
  rptType_production: 'Production inspection',
  rptType_receiving: 'Receiving inspection',
  rptType_reinspection: 'Re-inspection',
  rptType_none: 'Inspection report',
  rptTypeShort_fai: 'First article',
  rptTypeShort_production: 'Production',
  rptTypeShort_receiving: 'Receiving',
  rptTypeShort_reinspection: 'Re-inspection',
  rptTypeChip_fai: 'FAIR',
  rptTypeChip_production: 'PIR',
  rptTypeChip_receiving: 'RIR',
  rptTypeChip_reinspection: 'RIN',
  rptTypeChip_none: 'IR',
  rptTypeChipPartial: 'Partial FAI',
  rptTypeHint_fai: 'SAE AS9102: every characteristic of a new part, or only those a change affected (partial)',
  rptTypeHint_production: 'A production lot, by sampling; usually the classified characteristics',
  rptTypeHint_receiving: 'Incoming inspection of a received lot, with its purchase order and supplier',
  rptTypeHint_reinspection: 'Only the characteristics a nonconformance names',

  // FAI
  rptFaiScope_full: 'Full FAI',
  rptFaiScope_partial: 'Partial FAI',
  rptFaiReason_new_part: 'New part',
  rptFaiReason_design_change: 'Design change',
  rptFaiReason_process_change: 'Manufacturing process change',
  rptFaiReason_source_change: 'Change of source or supplier',
  rptFaiReason_tooling_change: 'Tooling change',
  rptFaiReason_location_change: 'Change of manufacturing location',
  rptFaiReason_production_lapse: 'Production lapse of more than two years',
  rptFaiReason_natural_event: 'Natural or man-made event',
  rptFaiReason_corrective_action: 'Corrective action',
  rptFaiReason_other: 'Other',

  // Sampling and scope, as printed in the workbook
  rptSampling_100: 'Every part of the lot (100%)',
  rptSampling_fixed: '{{n}} parts per characteristic',
  rptScopeText_all: 'All characteristics ({{count}})',
  rptScopeText_classified: 'Classified characteristics ({{count}} of {{total}})',
  rptScopeText_changed: 'Changed since the baseline FAI ({{count}} of {{total}})',
  rptScopeText_chosen: 'Chosen characteristics ({{count}} of {{total}})',

  // Generate
  rptGenerateTyped: 'Generate {{type}}',
  rptGenerateTypedHint: 'Generate a {{type}} report of version {{version}} now; Options picks the type, template and characteristics',
  rptDefaultBecause_fai_full: 'No first article inspection yet: a full FAI',
  rptDefaultBecause_fai_partial: 'Revision {{revision}} has no FAI yet: a partial FAI against version {{baseline}}',
  rptDefaultBecause_production: 'Revision {{revision}} has had its FAI: a production report',
  rptGeneratedTyped: '{{type}} {{number}} generated',
  rptNoClassified:
    'No characteristic is classified critical, major or key, so all {{count}} are in the report. Classify characteristics in the table, or choose them with Options.',
  rptSelectionEmpty_none_changed:
    'Nothing changed since the baseline FAI, so a partial FAI has nothing to re-verify. Choose characteristics with Options, or generate a full FAI.',
  rptSelectionEmpty_none_chosen: 'Choose the characteristics the report covers.',
  rptSelectionEmpty_no_classified: 'Every characteristic has an inspection rate of 0 for this report type.',
  rptSelectionEmpty_no_baseline:
    'A partial FAI needs the version of the FAI it builds on. Pick the baseline, or generate a full FAI.',
  rptBaselineNotExact:
    'The baseline version has no inspection snapshot of its own; its changes were judged against an older snapshot. Check the characteristics.',
  rptRegenerateUnmapped:
    'Version {{version}} no longer has these characteristics of the re-inspection: balloon {{balloons}}. Generate it with Options and choose them again.',
  rptFaiBaselineRequired: 'Pick the version of the FAI this one builds on.',
  rptSamplingError_lot_size_needed: 'Inspecting every part needs the lot size.',
  rptSamplingError_sample_larger_than_lot: 'The sample is larger than the lot.',
  rptSamplingError_too_many_measurements:
    'That is more than 2,000 measurements for one workbook. Use a smaller sample, or split the lot.',

  // Options dialog
  rptTypeLabel: 'Report type',
  rptFaiScopeLabel: 'Scope',
  rptFaiReasonLabel: 'Reason for the FAI',
  rptFaiBaselineLabel: 'Baseline (the version with the last FAI)',
  rptFaiBaselineAccepted: '{{label}} · FAI accepted',
  rptFaiBaselinePending: '{{label}} · FAI not accepted yet',
  rptFaiNoBaseline: 'This drawing has no earlier FAI for a partial FAI to build on: generate a full FAI.',
  rptLotNumber: 'Lot / batch number',
  rptLotSize: 'Lot size',
  rptSamplingLabel: 'Sampling',
  rptSamplingPlan_fixed: 'Fixed sample',
  rptSamplingPlan_100: 'Every part',
  rptSampleCount: 'Parts per characteristic',
  rptSamplingNote:
    'A characteristic’s own sample size or inspection rate (table columns) decides over this. ANSI/ASQ Z1.4 plans are not offered: they ship once their tables are checked against the published standard.',
  rptPoNumber: 'Purchase order',
  rptSupplier: 'Supplier',
  rptNcrReference: 'Nonconformance (NCR) number',
  rptNcrRequired: 'Enter the nonconformance this re-inspection follows.',
  rptCharacteristics: 'Characteristics',
  rptCharMode_classified: 'Classified',
  rptCharMode_all: 'All',
  rptCharMode_chosen: 'Choose',
  rptCharIncluded: '{{count}} of {{total}} included',
  rptCharChangedCount: '{{count}} changed since the baseline',
  rptCharLoading: 'Reading the version’s characteristics…',
  rptCharNone: 'This version has no characteristics.',
  rptCharSelectAll: 'All',
  rptCharSelectNone: 'None',
  rptCharChanged: 'Changed',
  rptCharNew: 'New',
  rptCharClassifiedTitle: 'Critical, major and key characteristics; a characteristic’s own inspection rate decides over its class',
  rptTemplateForType: 'Templates for {{type}}',
  rptTemplateOther: 'Other templates',
  rptRequiredField: 'Required',

  // Reports view
  rptFilterTypeAll: 'All',
  rptFilterTypeLabel: 'Filter by report type',
  rptTypeLot: 'Lot {{lot}}',
  rptTypeNcr: '{{ncr}}',
  rptTypeBaseline: 'against v{{version}}',
  rptTypeCharCount: '{{count}} of {{total}}',

  // Import
  rptImportOtherSelection:
    'This workbook belongs to another report of the same version with other characteristics. Import it on its own report.',

  // Template settings
  tplTypes: 'Report types',
  tplTypesHint: 'Which reports the template is offered for. None selected: every type.',
  tplTypesAny: 'Any type',
  tplDefaultFor: 'Default for',
  tplDefaultForType: 'Default for {{type}}',
  tplMakeDefaultFor: 'Make default for {{type}}',
  tplClearDefaultFor: 'Stop being the default for {{type}}',
  tplTypesSaved: 'Report types saved',
  tplBuiltinAs9102: 'First article inspection (AS9102 Forms 1-3)',
  tplBuiltinAs9102Desc: 'AS9102 Form 1 (part), Form 2 (materials, processes, tests) and Form 3 (characteristics), with the ballooned drawing.',
  tplBuiltinProduction: 'Production inspection',
  tplBuiltinProductionDesc: 'Lot, sampling plan and one result per sampled part, with the lot disposition.',
  tplBuiltinReceiving: 'Receiving inspection',
  tplBuiltinReceivingDesc: 'Supplier, purchase order, lot and certificate, sampling plan and one result per sampled part.',
  tplBuiltinReinspection: 'Re-inspection',
  tplBuiltinReinspectionDesc: 'The nonconformance and only the characteristics it names, with three measured values each.',
  tplTok_REPORT_TYPE: 'Report type (First article inspection, Production inspection, ...)',
  tplTok_FAI_TYPE: 'Full FAI or Partial FAI (first article only)',
  tplTok_FAI_REASON: 'Reason for the FAI',
  tplTok_FAI_BASELINE: 'The version a partial FAI builds on',
  tplTok_LOT_NUMBER: 'Lot or batch number (production and receiving)',
  tplTok_LOT_SIZE: 'Lot size',
  tplTok_SAMPLING_PLAN: 'Sampling plan (every part, or n parts per characteristic)',
  tplTok_SAMPLE_SIZE: 'Parts measured per characteristic (the largest)',
  tplTok_CHARACTERISTIC_SCOPE: 'Which characteristics the report includes',
  tplTok_PO_NUMBER: 'Purchase order (receiving)',
  tplTok_SUPPLIER: 'Supplier (receiving)',
  tplTok_NCR_REFERENCE: 'Nonconformance number (re-inspection)',

  // Report naming settings
  rnTok_type: 'Report type: FAIR, PIR, RIR or RIN (IR before types); {n} then counts per type',
  rnLotTitle: 'Production and receiving reports',
  rnLotScope: 'Characteristics',
  rnLotScopeHint:
    'What a production or receiving report includes when none are chosen. Classified: critical, major and key characteristics (all of them when none are classified). A characteristic’s own inspection rate decides over this.',
  rnLotScope_classified: 'Classified',
  rnLotScope_all: 'All',
  rnSampleSize: 'Parts per characteristic',
  rnSampleSizeHint:
    'The fixed sample of a report generated without options. A characteristic’s own sample size or inspection rate decides over this.',
}
