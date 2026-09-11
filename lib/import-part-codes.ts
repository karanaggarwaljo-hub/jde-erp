/** Deciding whether a batch of parts about to be imported can all keep their codes.
 *
 *  A part number is meant to name one part. Until September 2026 nothing enforced that, and five
 *  different things ended up answering to SP-239 — a brake plate, a pump shaft, a shovel rod, a
 *  slew tube and a stabiliser ram. The database now refuses a second part with the same code, so
 *  a spreadsheet carrying one would fail as a whole with a constraint message nobody can act on.
 *
 *  This finds the clashes first, so the screen can say which codes they are and where they clash.
 *  Blank codes are not clashes: plenty of parts have no code, and the database gives those their
 *  own when they are created one at a time.
 */

export type CodeClash = {
  code: string;
  /** 'file' — the same code appears on more than one row of the spreadsheet.
   *  'inventory' — the code is already on a part in this company. */
  where: 'file' | 'inventory';
  /** Which spreadsheet rows carry it, counting the header as row 1 the way a spreadsheet does. */
  rows: number[];
};

function normalise(code: unknown): string {
  return typeof code === 'string' ? code.trim().toLowerCase() : '';
}

/**
 * @param rows           the parts as read from the file, in file order
 * @param existingCodes  every part number already used in this company
 * @param firstDataRow   the spreadsheet row number of rows[0] (2 when row 1 is the header)
 */
export function findCodeClashes(
  rows: Array<Record<string, unknown>>,
  existingCodes: string[],
  firstDataRow = 2
): CodeClash[] {
  const taken = new Set(existingCodes.map(normalise).filter(Boolean));
  const seenInFile = new Map<string, number[]>();

  rows.forEach((row, index) => {
    const code = normalise(row.part_number);
    if (!code) return;
    seenInFile.set(code, [...(seenInFile.get(code) ?? []), index + firstDataRow]);
  });

  const clashes: CodeClash[] = [];
  for (const [code, rowNumbers] of seenInFile) {
    // Reported against inventory first: that is the one the owner has to look up rather than just
    // scroll to, so naming it is more useful than saying the file repeats itself.
    if (taken.has(code)) clashes.push({ code, where: 'inventory', rows: rowNumbers });
    else if (rowNumbers.length > 1) clashes.push({ code, where: 'file', rows: rowNumbers });
  }
  return clashes;
}

/** One sentence the owner can act on, naming at most a few codes so the message stays readable. */
export function describeCodeClashes(clashes: CodeClash[]): string {
  if (clashes.length === 0) return '';
  const shown = clashes.slice(0, 5).map((clash) => {
    const rows = clash.rows.join(', ');
    return clash.where === 'inventory'
      ? `${clash.code.toUpperCase()} (row ${rows}) is already used by a part you have`
      : `${clash.code.toUpperCase()} appears on rows ${rows} of the file`;
  });
  const rest = clashes.length > shown.length ? `, and ${clashes.length - shown.length} more` : '';
  return `Nothing was imported, because a part number has to name one part: ${shown.join('; ')}${rest}. `
    + 'Give each of them its own number, or clear the number and one will be generated.';
}
