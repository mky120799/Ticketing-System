/**
 * Rows to CSV. Cells beginning with = + - @ would be executed as formulas by spreadsheet software, so they are neutralised;
 * cells with commas, quotes or line breaks are quoted.
 */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const columns = Object.keys(rows[0]);
  const cell = (value: unknown) => { let text = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value); if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`; return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  return [columns.join(','), ...rows.map((row) => columns.map((column) => cell(row[column])).join(','))].join('\n');
}
