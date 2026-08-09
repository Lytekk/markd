import type { TextStats } from "./text-stats";

export interface MarkdownStatsWorkerRequest {
  id: number;
  markdown: string;
}

export interface MarkdownStatsWorkerReply {
  id: number;
  stats: TextStats | null;
}

/**
 * Own the lazy Source-stats worker and its latest-request contract. Results
 * from a departed tab/mode are ignored; worker startup/runtime failures fall
 * back to the caller's synchronous parser instead of losing status counts.
 */
export class MarkdownStatsWorkerClient {
  private worker: Worker | null = null;
  private requestId = 0;
  private pending: MarkdownStatsWorkerRequest | null = null;

  constructor(
    private readonly createWorker: () => Worker,
    private readonly onStats: (stats: TextStats) => void,
    private readonly fallback: (markdown: string) => TextStats | null,
  ) {}

  request(markdown: string): void {
    const request = { id: ++this.requestId, markdown };
    this.pending = request;

    try {
      const worker = this.worker ?? this.startWorker();
      worker.postMessage(request);
    } catch {
      this.pending = null;
      this.publishFallback(markdown);
    }
  }

  cancel(): void {
    this.requestId += 1;
    this.pending = null;
  }

  dispose(): void {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }

  private startWorker(): Worker {
    const worker = this.createWorker();
    worker.onmessage = (event: MessageEvent<MarkdownStatsWorkerReply>) => {
      const reply = event.data;
      if (reply.id !== this.requestId || this.pending?.id !== reply.id) return;
      const markdown = this.pending.markdown;
      this.pending = null;
      if (reply.stats) this.onStats(reply.stats);
      else this.publishFallback(markdown);
    };
    worker.onerror = () => {
      const pending = this.pending;
      this.worker?.terminate();
      this.worker = null;
      this.pending = null;
      if (pending && pending.id === this.requestId) this.publishFallback(pending.markdown);
    };
    this.worker = worker;
    return worker;
  }

  private publishFallback(markdown: string): void {
    const stats = this.fallback(markdown);
    if (stats) this.onStats(stats);
  }
}
