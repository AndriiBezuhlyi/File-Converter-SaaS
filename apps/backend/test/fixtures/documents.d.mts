export function documentFixtures(): Record<
  'docx' | 'odt' | 'xlsx' | 'pptx' | 'csv' | 'txt',
  Buffer
>;
export const documentText: string;
export function officeEntries(source: 'docx' | 'xlsx' | 'pptx'): Record<string, string>;
export function odtEntries(): Record<string, string>;
