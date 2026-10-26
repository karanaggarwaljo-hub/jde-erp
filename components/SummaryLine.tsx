/**
 * A screen's headline figures, written as one short line under its title.
 *
 * Most screens used to open with three or four big number boxes, each with an icon, a coloured
 * badge and a line of small print. The owner found the ERP cluttered, so the same numbers now sit
 * in one line and the list the screen is for starts near the top. The small print that explained a
 * figure is kept as `hint`, shown when the figure is pointed at.
 */
export type SummaryFact = {
  /** The figure itself, already formatted: "₹1,200", "258", "85.9%". */
  value: string;
  /** What it counts, in plain words after the figure: "parts", "to collect". */
  label: string;
  /** Colours the figure: red for something to act on, amber for a warning, green for all clear. */
  tone?: 'bad' | 'warn' | 'good';
  /** How the figure is worked out, for anyone who points at it. */
  hint?: string;
};

export default function SummaryLine({ facts }: { facts: SummaryFact[] }) {
  if (facts.length === 0) return null;
  return (
    <p className="summary-line">
      {facts.map((fact) => (
        <span key={fact.label} className={`summary-fact${fact.tone ? ` ${fact.tone}` : ''}`} title={fact.hint}>
          <strong>{fact.value}</strong> {fact.label}
        </span>
      ))}
    </p>
  );
}
