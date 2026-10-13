import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// The recorded Claude client: answers from files instead of the network.
//
// A pack may carry recordings/drafts/<document key>.json, each holding the
// response to the two drafting calls for that document:
//
//   { "document": "<key>", "outline": { ...outline response... }, "slides": { ...slides response... } }
//
// The pipeline sends the same prompt and schema it would send to Claude; this
// client looks the answer up by the document the request is about. Everything
// downstream (the tells, the fact check, the rules, the render) runs on a
// recorded answer exactly as on a live one, which is the point: the whole engine
// runs and is tested offline, and switches to the live model when a key is set.
//
// A request with no recording throws NoRecording, which the pipeline treats like
// a document that did not yield a post, and moves on.

export class NoRecording extends Error {
  constructor(what) {
    super(`no recording for ${what}`);
    this.name = 'NoRecording';
    this.code = 'no_recording';
  }
}

export function recordedClient() {
  const cache = new Map();
  const load = (file) => {
    if (!cache.has(file)) cache.set(file, existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
    return cache.get(file);
  };
  return {
    kind: 'recorded',
    async json({ task, meta = {} }) {
      const dir = meta.recordingsDir;
      const key = meta.docKey;
      if (!dir || !key) throw new NoRecording(`${task} (no document key)`);
      const rec = load(path.join(dir, 'drafts', `${key}.json`));
      const data = rec?.[meta.recordingTask || task];
      if (!data) throw new NoRecording(`${task} on ${key}`);
      // A recording answers for the format it was written for, and no other.
      if (rec.format && meta.format && rec.format !== meta.format) throw new NoRecording(`${task} on ${key} as ${meta.format} (recorded as ${rec.format})`);
      // Redrafts and reviews are not recorded: a recorded draft either passes the
      // checks as written or the post is blocked, which is what the checks are for.
      if (meta.attempt > 0) throw new NoRecording(`${task} attempt ${meta.attempt} on ${key}`);
      return { data: structuredClone(data), usage: null, model: meta.model, estimated: true };
    },
  };
}
