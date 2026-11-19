'use client';

/**
 * "Write a new post": pick a machine, pick a topic (or type one), and the AI writes a first draft.
 *
 * Three choices and one button. The topic bank (lib/blog.ts TOPICS) lists the topics not yet written
 * first, so working through "every topic" is simply taking the next one down the list. Nothing is
 * published from here: what comes back is saved as a draft and opened for the owner to check.
 */

import { useState } from 'react';
import { CheckCircle2, PenLine } from 'lucide-react';
import { parseJsonOrThrow } from '@/lib/parseJsonOrThrow';
import { LENGTHS, MACHINES, topicsFor, type BlogDraft, type LengthId, type Machine } from '@/lib/blog';

export type WrittenDraft = BlogDraft & { model: string; machine: Machine; topic: string; topicId: string | null };

export default function BlogWriterModal({ companyId, writtenTopicIds, onWritten, onClose }: {
  companyId: string;
  /** Topics that already have a post, draft or published. */
  writtenTopicIds: ReadonlySet<string>;
  /** Called with the draft once it is written. The page saves it and opens it. */
  onWritten: (draft: WrittenDraft) => Promise<void>;
  onClose: () => void;
}) {
  const [machine, setMachine] = useState<Machine>('backhoe');
  const [topicId, setTopicId] = useState<string | null>(null);
  const [ownTopic, setOwnTopic] = useState('');
  const [notes, setNotes] = useState('');
  const [length, setLength] = useState<LengthId>('standard');
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState('');

  const topics = topicsFor(machine, writtenTopicIds);
  const chosen = topics.find((topic) => topic.id === topicId);
  const topic = ownTopic.trim() || chosen?.title || '';

  const chooseMachine = (next: Machine) => {
    setMachine(next);
    setTopicId(null);
  };

  const write = async () => {
    if (!topic || writing) return;
    setWriting(true);
    setError('');
    try {
      const res = await fetch('/api/ai-blog-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, machine, topic, topicId: ownTopic.trim() ? null : topicId, notes, length }),
      });
      const draft = (await parseJsonOrThrow(res, 'The article could not be written.')) as BlogDraft & { model?: string };
      await onWritten({ ...draft, model: draft.model ?? '', machine, topic, topicId: ownTopic.trim() ? null : topicId });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The article could not be written. Please try again.');
      setWriting(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: '720px' }} role="dialog" aria-modal="true" aria-labelledby="blog-writer-title">
        <div className="modal-header">
          <div>
            <h3 id="blog-writer-title" className="modal-title">Write a new post</h3>
            <p className="text-muted text-sm" style={{ marginTop: '3px' }}>The AI writes a first draft. You read it and publish it when you are happy.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" aria-label="Close" disabled={writing} onClick={onClose}>✕</button>
        </div>

        <div className="modal-body flex flex-col gap-4">
          {error && <div className="alert alert-danger" role="alert">{error}</div>}

          <div className="form-group" style={{ marginBottom: 0 }}>
            <span className="form-label" id="blog-machine-label">1. Which machine?</span>
            <div className="pay-how blog-machine-choices" role="group" aria-labelledby="blog-machine-label">
              {MACHINES.map((entry) => (
                <button key={entry.id} type="button" aria-pressed={machine === entry.id} disabled={writing}
                  className={`pay-how-choice blog-machine-choice${machine === entry.id ? ' active' : ''}`} onClick={() => chooseMachine(entry.id)}>
                  <span>{entry.label}</span>
                  <small>{entry.hint}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <span className="form-label" id="blog-topic-label">2. Which topic?</span>
            <div className="blog-topic-list" role="radiogroup" aria-labelledby="blog-topic-label">
              {topics.map((entry) => (
                <button key={entry.id} type="button" role="radio" aria-checked={topicId === entry.id && !ownTopic.trim()} disabled={writing}
                  className={`blog-topic${topicId === entry.id && !ownTopic.trim() ? ' active' : ''}${entry.written ? ' is-written' : ''}`}
                  onClick={() => { setTopicId(entry.id); setOwnTopic(''); }}>
                  <span>{entry.title}</span>
                  {entry.written && <small><CheckCircle2 size={13} aria-hidden="true" /> Written</small>}
                </button>
              ))}
            </div>
            <label className="form-label" htmlFor="blog-own-topic" style={{ marginTop: '10px' }}>Or type your own topic</label>
            <input id="blog-own-topic" className="form-input" maxLength={300} disabled={writing}
              placeholder="For example: Why my 3DX backhoe jerks when I lift the loader arm"
              value={ownTopic} onChange={(event) => setOwnTopic(event.target.value)} />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" htmlFor="blog-notes">3. Anything the article should say? <span className="text-muted" style={{ fontWeight: 400 }}>(optional)</span></label>
            <textarea id="blog-notes" className="form-input" rows={2} maxLength={1500} disabled={writing}
              placeholder="For example: we keep chisels, bushes and seal kits for most breakers in stock."
              value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <span className="form-label" id="blog-length-label">How long?</span>
            <div className="pay-how blog-length-choices" role="group" aria-labelledby="blog-length-label">
              {LENGTHS.map((entry) => (
                <button key={entry.id} type="button" aria-pressed={length === entry.id} disabled={writing} title={entry.hint}
                  className={`pay-how-choice${length === entry.id ? ' active' : ''}`} onClick={() => setLength(entry.id)}>
                  {entry.label}
                </button>
              ))}
            </div>
            <span className="text-muted text-sm">{LENGTHS.find((entry) => entry.id === length)?.hint}</span>
          </div>
        </div>

        <div className="modal-footer modal-footer--sticky">
          <span className="text-muted text-sm" style={{ marginRight: 'auto' }}>
            {writing ? 'Writing the article. This can take up to a minute…' : topic ? `Topic: ${topic}` : 'Choose a topic above, or type your own.'}
          </span>
          <button type="button" className="btn btn-secondary" disabled={writing} onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={!topic || writing} onClick={write}>
            <PenLine size={16} /> {writing ? 'Writing…' : 'Write the post'}
          </button>
        </div>
      </div>
    </div>
  );
}
