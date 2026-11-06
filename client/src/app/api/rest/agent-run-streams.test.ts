/** Node's web streams; the jest environment lacks the fetch globals. */
import { ReadableStream } from "node:stream/web";
import { TextDecoder, TextEncoder } from "node:util";

import type { SessionUpdate } from "@app/api/agentic/acp";
import type { ChatItem } from "@app/pages/agent-runs/transcript/transcript-model";
import { reduceUpdate } from "@app/pages/agent-runs/transcript/transcript-model";

import {
  frameToUpdate,
  replayTranscript,
  streamAgentRunTranscript,
} from "./agent-run-streams";
import type { RecordedLine } from "./agent-run-streams";

// The jest environment lacks the browser's TextDecoder global, which the
// stream client itself uses.
if (typeof globalThis.TextDecoder === "undefined") {
  (globalThis as { TextDecoder?: unknown }).TextDecoder = TextDecoder;
}

jest.mock("@app/Constants", () => ({
  ...jest.requireActual("@app/Constants"),
  isAuthRequired: false,
}));

const chunk = (text: string): SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
});

const frame = (update: SessionUpdate, sessionId = "run-1") => ({
  jsonrpc: "2.0",
  method: "session/update",
  params: { sessionId, update },
});

const line = (update: SessionUpdate): RecordedLine => ({
  t: "2026-11-05T12:00:00.000000000Z",
  frame: frame(update),
});

/** Items without `at`, which is stamped per-call. */
const stripAt = (items: ChatItem[]) =>
  items.map((it) => {
    const { at, ...rest } = it as { at?: number };
    return { ...rest, ...(at === undefined ? {} : {}) };
  });

describe("frameToUpdate", () => {
  it("accepts both update methods", () => {
    expect(frameToUpdate(frame(chunk("x")))).toBeDefined();
    expect(
      frameToUpdate({
        jsonrpc: "2.0",
        method: "_goose/unstable/session/update",
        params: { sessionId: "run-1", update: chunk("x") },
      })
    ).toBeDefined();
  });

  it("rejects responses, other methods and malformed frames", () => {
    expect(
      frameToUpdate({ jsonrpc: "2.0", id: 1, result: {} })
    ).toBeUndefined();
    expect(
      frameToUpdate({ jsonrpc: "2.0", method: "session/prompt", params: {} })
    ).toBeUndefined();
    expect(frameToUpdate("junk")).toBeUndefined();
    expect(
      frameToUpdate({ jsonrpc: "2.0", method: "session/update", params: {} })
    ).toBeUndefined();
  });
});

describe("replayTranscript", () => {
  it("replays recorded frames to the same items as live updates", () => {
    const updates = [chunk("Hello "), chunk("world"), chunk("again")];
    let id = 0;
    const live = updates.reduce<ChatItem[]>(
      (items, u) => reduceUpdate(items, u, () => ++id),
      []
    );
    const replay = replayTranscript(updates.map(line));
    expect(stripAt(replay.items)).toEqual(stripAt(live));
  });

  it("records gap position", () => {
    const replay = replayTranscript([
      line(chunk("one")),
      { gap: { from: "2026-11-05T12:00:00Z", to: "2026-11-05T12:05:00Z" } },
      line({
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "read_file",
        status: "pending",
      }),
    ]);
    expect(replay.items).toHaveLength(2);
    expect(replay.gaps).toHaveLength(1);
    expect(replay.gaps[0]).toMatchObject({
      from: "2026-11-05T12:00:00Z",
      to: "2026-11-05T12:05:00Z",
      afterItemId: replay.items[0].id,
    });
  });
});

/**
 * A fetch Response stand-in: the jest environment has no Response global,
 * and the stream client only needs ok/status/headers/body.getReader().
 */
const chunkedResponse = (
  chunks: string[],
  headers: Record<string, string> = {}
) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  const all = new Map<string, string>(Object.entries(headers));
  return {
    ok: true,
    status: 200,
    headers: { get: (name: string) => all.get(name) ?? null },
    body: stream,
  } as unknown as Response;
};

const fetchMock = (responses: Array<Response | Error>) => {
  const calls: string[] = [];
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return calls;
};

describe("streamAgentRunTranscript", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("splits frames across chunks", async () => {
    fetchMock([
      chunkedResponse(['{"t":"1","frame":', '{"method":"session/update"}}\n']),
    ]);
    const lines: RecordedLine[] = [];
    await streamAgentRunTranscript("run-a", {
      follow: false,
      onLine: (l) => lines.push(l),
      signal: new AbortController().signal,
      isLive: () => false,
    });
    expect(lines).toHaveLength(1);
    expect((lines[0] as { t: string }).t).toBe("1");
  });

  it("resumes from offset after stream end", async () => {
    const twoLines =
      '{"t":"1","frame":{"method":"session/update"}}\n' +
      '{"t":"2","frame":{"method":"session/update"}}\n';
    const calls = fetchMock([
      chunkedResponse([twoLines]),
      chunkedResponse(['{"t":"3","frame":{"method":"session/update"}}\n']),
    ]);
    const lines: RecordedLine[] = [];
    let live = true;
    await streamAgentRunTranscript("run-a", {
      follow: false,
      onLine: (l) => {
        lines.push(l);
        if ((l as { t: string }).t === "3") live = false;
      },
      signal: new AbortController().signal,
      isLive: () => live,
    });
    expect(lines).toHaveLength(3);
    expect(calls[1]).toContain("offset=2");
    // No duplicates: each recorded line arrived exactly once.
    const ts = lines.map((l) => (l as { t: string }).t);
    expect(ts).toEqual(["1", "2", "3"]);
  });
});
