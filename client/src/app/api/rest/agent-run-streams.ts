import { isAuthRequired } from "@app/Constants";
import { GOOSE_UPDATE_METHOD } from "@app/api/agentic/acp";
import type { SessionUpdate } from "@app/api/agentic/acp";
import { userManager } from "@app/auth/oidc/userManager";
import type {
  ChatItem,
  RunUsage,
} from "@app/pages/agent-runs/transcript/transcript-model";
import {
  isRecord,
  mergeUsage,
  reduceUpdate,
} from "@app/pages/agent-runs/transcript/transcript-model";

/**
 * Streaming client for the hub's agent-run recordings: the raw container
 * log and the recorded ACP transcript. Both endpoints cut the connection
 * at the route's 300s idle timeout, so every stream tracks its offset
 * (bytes for logs, complete lines for transcripts) and the caller re-arms
 * it while the run is live.
 */

/** A recorded transcript line: a frame with its receive time, or a gap. */
export type RecordedLine =
  | { t: string; frame: unknown }
  | { gap: { from: string; to: string } };

/** What the hub said about the stream it served. */
export type StreamStatus = {
  source?: "live" | "saved";
  transcript?: "recording" | "complete" | "incomplete" | "skipped" | "none";
  skipReason?: string;
};

/** A transcript gap, positioned after the item it follows. */
export type TranscriptGap = {
  from: string;
  to: string;
  afterItemId: number;
};

export type TranscriptReplay = {
  items: ChatItem[];
  usage: RunUsage | null;
  gaps: TranscriptGap[];
};

/**
 * The session/update payload of a recorded frame, using the same rules as
 * AcpSession.handleNotification: both methods, a usable update payload,
 * and the session the update belongs to.
 */
export function frameToUpdate(
  frame: unknown
): { update: SessionUpdate; sessionId: string } | undefined {
  if (!isRecord(frame)) return undefined;
  if (frame.method !== "session/update" && frame.method !== GOOSE_UPDATE_METHOD)
    return undefined;
  const params = frame.params;
  if (!isRecord(params)) return undefined;
  const update = params.update;
  const sessionId =
    typeof params.sessionId === "string" ? params.sessionId : "";
  if (isRecord(update) && typeof update.sessionUpdate === "string") {
    return { update: update as SessionUpdate, sessionId };
  }
  return undefined;
}

/**
 * Fold recorded lines into the same shape the live panel shows: items via
 * the live reducer, usage via the live usage fold, and the gaps the
 * recorder marked, each positioned after the item it follows.
 */
export function replayTranscript(lines: RecordedLine[]): TranscriptReplay {
  let items: ChatItem[] = [];
  let usage: RunUsage | null = null;
  const gaps: TranscriptGap[] = [];
  let id = 0;
  for (const line of lines) {
    if ("gap" in line) {
      const last = items[items.length - 1];
      gaps.push({
        from: line.gap.from,
        to: line.gap.to,
        afterItemId: last ? last.id : -1,
      });
      continue;
    }
    const parsed = frameToUpdate(line.frame);
    if (!parsed) continue;
    const update = parsed.update;
    if (
      update.sessionUpdate === "usage_update" ||
      update.sessionUpdate === "message_usage"
    ) {
      usage = mergeUsage(usage, update);
      continue;
    }
    items = reduceUpdate(items, update, () => ++id);
  }
  return { items, usage, gaps };
}

/** Authorization header for the hub stream endpoints, when required. */
const authHeaders = async (): Promise<Record<string, string>> => {
  if (!isAuthRequired) return {};
  const token = (await userManager.getUser())?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

const runUrl = (name: string, kind: "logs" | "transcript") =>
  `/hub/agentic/agentruns/${encodeURIComponent(name)}/${kind}`;

/** Reads a fetch body as UTF-8 chunks; resolves when the stream ends. */
async function readChunks(
  res: Response,
  onChunk: (text: string, bytes: number) => void
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (!value) continue;
    // Byte length of the raw chunk, not the decoded length: the hub's
    // offset counts bytes and multibyte characters would shift it.
    onChunk(decoder.decode(value, { stream: true }), value.byteLength);
  }
}

const statusOf = (res: Response): StreamStatus => {
  const status: StreamStatus = {};
  const source = res.headers.get("X-Log-Source");
  if (source === "live" || source === "saved") status.source = source;
  const transcript = res.headers.get("X-Transcript-Status");
  if (transcript) status.transcript = transcript as StreamStatus["transcript"];
  const reason = res.headers.get("X-Transcript-Skip-Reason");
  if (reason) status.skipReason = reason;
  return status;
};

/**
 * Stream an agent run's container log. Chunks of decoded text go to
 * onChunk as they arrive. When the response ends without an abort and the
 * run is still live, the stream re-requests itself from its byte offset
 * (the route cuts idle connections at 300s).
 */
export async function streamAgentRunLogs(
  name: string,
  opts: {
    container?: string;
    follow: boolean;
    onChunk: (text: string) => void;
    onStatus?: (s: StreamStatus) => void;
    signal: AbortSignal;
    isLive: () => boolean;
  }
): Promise<void> {
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      container: opts.container ?? "agent",
      follow: String(opts.follow),
      offset: String(offset),
    });
    let res: Response;
    try {
      res = await fetch(`${runUrl(name, "logs")}?${params}`, {
        headers: await authHeaders(),
        signal: opts.signal,
      });
    } catch (err) {
      if (opts.signal.aborted) return;
      throw err;
    }
    if (!res.ok) throw new Error(`logs stream failed: ${res.status}`);
    opts.onStatus?.(statusOf(res));
    let live = false;
    try {
      await readChunks(res, (text, bytes) => {
        offset += bytes;
        opts.onChunk(text);
      });
    } catch (err) {
      if (opts.signal.aborted) return;
      throw err;
    }
    if (opts.signal.aborted) return;
    live = opts.isLive();
    if (!live) return;
    await new Promise((r) => setTimeout(r, 1000));
    if (opts.signal.aborted) return;
  }
}

/**
 * Stream an agent run's recorded transcript as RecordedLines. Complete
 * NDJSON lines go to onLine in order; a line split across chunks is
 * buffered until its newline. When the response ends without an abort and
 * the run is still live, the stream re-requests itself from its line
 * offset.
 */
export async function streamAgentRunTranscript(
  name: string,
  opts: {
    follow: boolean;
    onLine: (l: RecordedLine) => void;
    onStatus?: (s: StreamStatus) => void;
    signal: AbortSignal;
    isLive: () => boolean;
  }
): Promise<void> {
  let offset = 0;
  let buffered = "";
  const takeLines = (text: string, flush: boolean): number => {
    buffered += text;
    let count = 0;
    for (;;) {
      const nl = buffered.indexOf("\n");
      if (nl < 0) break;
      const raw = buffered.slice(0, nl);
      buffered = buffered.slice(nl + 1);
      count++;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (isRecord(parsed)) {
          opts.onLine(parsed as RecordedLine);
        }
      } catch {
        // A torn line: drop it rather than corrupt the transcript.
      }
    }
    if (flush && buffered) {
      buffered = "";
    }
    return count;
  };
  for (;;) {
    const params = new URLSearchParams({
      follow: String(opts.follow),
      offset: String(offset),
    });
    let res: Response;
    try {
      res = await fetch(`${runUrl(name, "transcript")}?${params}`, {
        headers: await authHeaders(),
        signal: opts.signal,
      });
    } catch (err) {
      if (opts.signal.aborted) return;
      throw err;
    }
    if (res.status === 404) {
      opts.onStatus?.(statusOf(res));
      return;
    }
    if (!res.ok) throw new Error(`transcript stream failed: ${res.status}`);
    opts.onStatus?.(statusOf(res));
    try {
      await readChunks(res, (text) => {
        offset += takeLines(text, false);
      });
    } catch (err) {
      if (opts.signal.aborted) return;
      throw err;
    }
    if (opts.signal.aborted) return;
    if (!opts.isLive()) return;
    await new Promise((r) => setTimeout(r, 1000));
    if (opts.signal.aborted) return;
  }
}
