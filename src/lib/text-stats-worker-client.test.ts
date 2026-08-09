import { describe, expect, it, vi } from "vitest";
import type { TextStats } from "./text-stats";
import {
  MarkdownStatsWorkerClient,
  type MarkdownStatsWorkerReply,
  type MarkdownStatsWorkerRequest,
} from "./text-stats-worker-client";

class WorkerMock {
  onmessage: ((event: MessageEvent<MarkdownStatsWorkerReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  messages: MarkdownStatsWorkerRequest[] = [];
  terminate = vi.fn();

  postMessage(message: MarkdownStatsWorkerRequest) {
    this.messages.push(message);
  }

  reply(reply: MarkdownStatsWorkerReply) {
    this.onmessage?.({ data: reply } as MessageEvent<MarkdownStatsWorkerReply>);
  }
}

describe("MarkdownStatsWorkerClient", () => {
  it("publishes only the newest worker result", () => {
    const worker = new WorkerMock();
    const onStats = vi.fn();
    const client = new MarkdownStatsWorkerClient(
      () => worker as unknown as Worker,
      onStats,
      () => null,
    );

    client.request("old");
    client.request("new");
    expect(worker.messages).toHaveLength(2);
    worker.reply({ id: worker.messages[0]!.id, stats: { words: 1, chars: 3 } });
    worker.reply({ id: worker.messages[1]!.id, stats: { words: 1, chars: 3 } });

    expect(onStats).toHaveBeenCalledTimes(1);
    expect(onStats).toHaveBeenCalledWith({ words: 1, chars: 3 });
  });

  it("invalidates an in-flight result when the active buffer changes", () => {
    const worker = new WorkerMock();
    const onStats = vi.fn();
    const client = new MarkdownStatsWorkerClient(
      () => worker as unknown as Worker,
      onStats,
      () => null,
    );

    client.request("departed tab");
    const request = worker.messages[0]!;
    client.cancel();
    worker.reply({ id: request.id, stats: { words: 2, chars: 12 } });

    expect(onStats).not.toHaveBeenCalled();
  });

  it("falls back synchronously when a Worker cannot be created", () => {
    const onStats = vi.fn();
    const fallback = vi.fn<(markdown: string) => TextStats | null>(() => ({
      words: 2,
      chars: 11,
    }));
    const client = new MarkdownStatsWorkerClient(
      () => {
        throw new Error("Worker unavailable");
      },
      onStats,
      fallback,
    );

    client.request("hello world");

    expect(fallback).toHaveBeenCalledWith("hello world");
    expect(onStats).toHaveBeenCalledWith({ words: 2, chars: 11 });
  });

  it("terminates its worker on disposal", () => {
    const worker = new WorkerMock();
    const client = new MarkdownStatsWorkerClient(
      () => worker as unknown as Worker,
      () => {},
      () => null,
    );
    client.request("text");

    client.dispose();

    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
