/**
 * Article formats: the shapes a blog post can take, so that posts do not all read alike.
 *
 * The owner asked for every new post to come out in a different format. Each format below tells the
 * AI writer (app/api/ai-blog-draft) how to lay the article out: a checklist to follow at the
 * machine, a fault finder organised by symptom, myths and facts, a comparison table and so on. The
 * writer picks the next format by itself (nextFormat: the one used least recently, so no two posts in
 * a row share one and every format comes round before any repeats), and the owner can choose another.
 *
 * The format is saved with the post (jde_blog_posts.format, scripts/blog-formats.sql) so the next
 * pick knows what was used. Its label is shown on the Blog screen and, after the machine, on the
 * website: "Backhoe loader · Checklist". Some formats use the article's checklists ("- [ ] item")
 * and tables ("| a | b |"), which lib/blog.ts parseBody reads.
 *
 * Adding a format is adding an entry here: nothing else lists them. The database only checks that
 * the id is a short lower-case word.
 */

export type FormatId =
  | 'guide'
  | 'steps'
  | 'checklist'
  | 'mistakes'
  | 'troubleshoot'
  | 'myths'
  | 'compare'
  | 'explainer'
  | 'tips'
  | 'buyers';

export type ArticleFormat = {
  id: FormatId;
  /** On the Blog screen and on the website after the machine. */
  label: string;
  /** One line for the owner under the label, in the writer. */
  hint: string;
  /** How the AI lays the article out. Written to the AI; read with the body rules in the route. */
  structure: string;
};

export const FORMATS: readonly ArticleFormat[] = [
  {
    id: 'guide',
    label: 'Complete guide',
    hint: 'Sections with headings, bullets and steps',
    structure:
      'A complete guide. Start with a short opening paragraph, then 4 to 7 sections with "## " headings, using bullets or numbered steps where they help. ' +
      'End with a short closing section that sums up what to do.',
  },
  {
    id: 'steps',
    label: 'Step-by-step',
    hint: 'One job, done in numbered steps',
    structure:
      'A step-by-step how-to for one job. Start with a short paragraph saying what the job is and when it needs doing. Then "## What you need" as a bullet list. ' +
      'Then one section per step, 5 to 8 of them, headed "## Step 1: ..." , "## Step 2: ..." and so on, each a short paragraph with bullets where useful, and a "> " safety note on the step where it matters. ' +
      'Then "## When to stop and call a mechanic" as bullets. End with "## After the job" in two or three sentences. ' +
      'A step that needs special equipment or training is named as a job for a trained mechanic, not explained. The title says it is a step-by-step guide.',
  },
  {
    id: 'checklist',
    label: 'Checklist',
    hint: 'Tick-box checks to follow at the machine',
    structure:
      'A checklist the reader follows at the machine. Start with a short paragraph saying when to use it. ' +
      'Then 3 to 5 "## " sections grouping the checks (for example before starting, walk-round, while working), each a checklist of "- [ ] " items: one check per item, saying what to look at and, in a few words, what good looks like. ' +
      'Then "## If a check fails" as a table with the columns | Check | What it may mean | What to do |. End with a closing paragraph of two or three sentences. The title says it is a checklist.',
  },
  {
    id: 'mistakes',
    label: 'Mistakes to avoid',
    hint: 'Common mistakes, and what to do instead',
    structure:
      'The common mistakes owners and operators make with this topic, 5 to 7 of them. Start with a short opening paragraph. ' +
      'Then one "## " section per mistake, headed with the mistake as a plain statement (for example "## Greasing the chisel with the breaker lifted"), ' +
      'each with one paragraph starting "**Why it hurts:**" and one starting "**Do this instead:**". ' +
      'End with "## The short version" as a bullet list, one line per mistake. The title names the number of mistakes.',
  },
  {
    id: 'troubleshoot',
    label: 'Fault finder',
    hint: 'Symptom, likely cause, what to check',
    structure:
      'A fault finder organised by symptom. Start with a short paragraph. ' +
      'Then "## Quick fault finder" as a table with the columns | Symptom | Likely causes | What to check first |, with 4 to 7 rows. ' +
      'Then one "## " section per symptom, in the same order, going from the most common cause to the least and saying what the reader can safely check. ' +
      'Then "## Jobs for a trained mechanic" as bullets. End with a short closing paragraph. The title names the problem the reader has.',
  },
  {
    id: 'myths',
    label: 'Myths and facts',
    hint: 'Common beliefs, and the truth',
    structure:
      'Myths and facts: 4 to 6 things people commonly believe about this topic that are wrong or only half true. Start with a short opening paragraph. ' +
      'Then for each, a "## Myth: ..." heading stating the belief, a "> **Fact:** ..." line with the truth in one sentence, and a paragraph explaining why and what to do instead. ' +
      'Only take on beliefs that are genuinely common among operators and owners. End with "## What to remember" as bullets. The title says it is about myths.',
  },
  {
    id: 'compare',
    label: 'Comparison',
    hint: 'Two or three options side by side',
    structure:
      'A comparison of two or three real options within this topic (for example repair or replace, two kinds of part, two ways of doing the job, or doing it now against putting it off). ' +
      'Start with a short paragraph naming the options. Then "## At a glance" as a table with a first column of points and one column per option, 4 to 7 rows of practical points such as cost over time, downtime, life and when it suits; no prices and no exact figures in it. ' +
      'Then one "## " section per option. Then "## Which one suits you" with one bullet per situation. End with a short closing paragraph. The title names the options being compared.',
  },
  {
    id: 'explainer',
    label: 'How it works',
    hint: 'What the part does, and why it fails',
    structure:
      'An explainer, so the reader understands the part or system behind this topic. Start with a short paragraph. ' +
      'Then the sections "## What it does", "## How it works", "## Why it wears or fails", "## Signs it needs attention" (bullets) and "## How to make it last" (bullets). ' +
      'Explain how it works in plain words, as to an operator at the counter, and explain any technical word you have to use. End with a short closing paragraph. The title asks or answers how it works.',
  },
  {
    id: 'tips',
    label: 'Quick tips',
    hint: 'Short practical tips, one per heading',
    structure:
      'Quick tips: 8 to 12 short, practical tips. Start with a short opening paragraph. ' +
      'Then a "## " heading for each tip, written as the tip itself in a few words (for example "## Grease before the shift, not after"), followed by two to four sentences. ' +
      'Put a "> " safety note under any tip that involves risk. End with "## Start with these three" naming the three tips that matter most and why. The title names the number of tips.',
  },
  {
    id: 'buyers',
    label: "Buyer's guide",
    hint: 'Buying the right replacement part',
    structure:
      "A buyer's guide to getting the right replacement part for this topic. Start with a short paragraph. " +
      'Then "## Find the right part" (what to note from the machine and the old part: the model, the serial number or PIN, the part number), "## Questions to ask before you buy" as a numbered list, ' +
      '"## Check it when it arrives" as a checklist of "- [ ] " items, and "## Warning signs" as bullets (signs of a wrong, used or poor part). ' +
      'Never give prices and never name sellers. End with a short closing paragraph. The title says it is about buying.',
  },
];

export const DEFAULT_FORMAT: FormatId = 'guide';

export const isFormat = (value: unknown): value is FormatId => FORMATS.some((format) => format.id === value);

export const formatById = (id: unknown): ArticleFormat =>
  FORMATS.find((format) => format.id === id) ?? FORMATS.find((format) => format.id === DEFAULT_FORMAT)!;

/** The format's label, or "Complete guide" for a post written before there were formats. */
export const formatLabel = (id: unknown): string => formatById(id).label;

/**
 * The format for the next post, given the formats of the posts already written, newest first.
 *
 * The one used least recently: a format never used comes first (one of them at random, so the first
 * posts do not always run in the same order), otherwise the one whose last use is the oldest. So no
 * two posts in a row share a format, and every format is used once before any is used again.
 * Entries that are not a format (a post from before formats) are skipped.
 */
export function nextFormat(recentFirst: ReadonlyArray<unknown>, random: () => number = Math.random): FormatId {
  const lastUsed = new Map<FormatId, number>();
  recentFirst.forEach((id, index) => {
    if (isFormat(id) && !lastUsed.has(id)) lastUsed.set(id, index);
  });
  const neverUsed = FORMATS.filter((format) => !lastUsed.has(format.id));
  if (neverUsed.length) return neverUsed[Math.min(neverUsed.length - 1, Math.floor(random() * neverUsed.length))].id;
  return [...FORMATS].sort((a, b) => (lastUsed.get(b.id) ?? 0) - (lastUsed.get(a.id) ?? 0))[0].id;
}

/** "Backhoe loader · Checklist" for a post in a format of its own; the machine alone for a plain
 *  guide or a post from before formats. */
export const machineAndFormat = (machine: string, format: unknown): string =>
  isFormat(format) && format !== DEFAULT_FORMAT ? `${machine} · ${formatLabel(format)}` : machine;
