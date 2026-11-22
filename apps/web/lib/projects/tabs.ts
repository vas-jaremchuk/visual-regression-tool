/** Settings tabs in display order (03 §6, 08 §1). */
export const SETTINGS_TABS = [
  { tab: 'general', label: 'General' },
  { tab: 'storage', label: 'Storage' },
  { tab: 'access', label: 'Access' },
  { tab: 'capture', label: 'Capture' },
  { tab: 'viewports', label: 'Viewports' },
  { tab: 'diff', label: 'Diff' },
  { tab: 'ignore-rules', label: 'Ignore rules' },
  { tab: 'notifications', label: 'Notifications' },
  { tab: 'members', label: 'Members' },
  { tab: 'audit', label: 'Audit log' },
  { tab: 'danger', label: 'Danger zone' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['tab'];
