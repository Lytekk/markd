import { computeStandaloneMarkdownTextStats } from "./markdown-stats-parser";
import type {
  MarkdownStatsWorkerReply,
  MarkdownStatsWorkerRequest,
} from "./text-stats-worker-client";

self.onmessage = (event: MessageEvent<MarkdownStatsWorkerRequest>) => {
  let reply: MarkdownStatsWorkerReply;
  try {
    reply = {
      id: event.data.id,
      stats: computeStandaloneMarkdownTextStats(event.data.markdown),
    };
  } catch {
    // The main thread owns the fail-safe fallback using the editor's configured
    // tokenizer. Never let one malformed document kill the reusable worker.
    reply = { id: event.data.id, stats: null };
  }
  self.postMessage(reply);
};
