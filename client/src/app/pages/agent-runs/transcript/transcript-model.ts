import type {
  ElicitationOutcome,
  ElicitationRequest,
  PermissionRequest,
  SessionUpdate,
  ToolCallDiff,
} from "@app/api/agentic/acp";

// ------------------------------------------------------------- chat model
// Moved unchanged from ChatPanel.tsx so the recorded-transcript replay
// (agent-run-streams.ts) folds frames with the exact reducer the live
// panel uses.

/**
 * Lifecycle of a redirect injected into the agent's active turn (goose
 * steer, relayed by the harness tee): the message is queued, the agent reads
 * it at its next step, and the turn keeps running.
 */
export type SteerState =
  /** Request on its way to the harness. */
  | { state: "sending" }
  /** goose queued it; the agent reads it at its next step. */
  | { state: "queued"; messageId: string }
  /**
   * The running turn picked it up — goose echoed it back as a user
   * message. `streamed` marks a redirect this panel only knows from the
   * stream (another viewer's), whose text may still arrive in chunks.
   */
  | { state: "delivered"; messageId?: string; streamed?: boolean }
  /** The turn ended before the agent reached it; goose discards it. */
  | { state: "dropped"; messageId?: string }
  | { state: "failed"; message: string };

export interface UserItem {
  kind: "user";
  id: number;
  /** Creation time (epoch ms) -- PF Message re-stamps "now" without one. */
  at: number;
  text: string;
  /** Set when the message is a mid-turn redirect rather than a prompt. */
  steer?: SteerState;
}
export interface AgentItem {
  kind: "agent";
  id: number;
  at: number;
  text: string;
}
export interface ThoughtItem {
  kind: "thought";
  id: number;
  at: number;
  text: string;
}
export interface ToolItem {
  kind: "tool";
  id: number;
  at: number;
  toolCallId: string;
  title: string;
  status: string;
  detail: string;
  /** The call's rawInput as announced (e.g. load_skill's `{name}`), if any. */
  input?: Record<string, unknown>;
}
export interface PlanEntry {
  content: string;
  status: string;
}
/** The agent's task ladder; each plan update replaces the previous one. */
export interface PlanItem {
  kind: "plan";
  id: number;
  entries: PlanEntry[];
}
export interface PermissionItem {
  kind: "permission";
  id: number;
  title?: string;
  /** File modifications to preview before answering (ACP diff blocks). */
  diffs?: ToolCallDiff[];
  options: PermissionRequest["options"];
  /** optionId chosen by the user, or "cancelled". Unset while pending. */
  chosen?: string;
  /** Concluded elsewhere (another viewer answered, or the harness timed it
   * out) rather than by this viewer — the card closes either way. */
  external?: boolean;
}
/**
 * The agent asking the human a question (elicitation/create, e.g. the
 * harness's ask_user tool). The agent's turn is blocked until it is
 * answered, declined, or the harness times it out.
 */
export interface AskItem {
  kind: "ask";
  id: number;
  at: number;
  message: string;
  schema: ElicitationRequest["requestedSchema"];
  /** Set once answered: what went back to the agent. */
  outcome?: ElicitationOutcome;
  /** Concluded elsewhere (another viewer answered, or the harness timed it
   * out) rather than by this viewer — the card closes either way. */
  external?: boolean;
}
/** A one-line transcript divider (e.g. "stop requested"). */
export interface NoticeItem {
  kind: "notice";
  id: number;
  text: string;
}
/**
 * A status notice on goose's custom channel (`status_message` of type
 * notice): goose's own (a compaction, a skipped step) or the harness's
 * stage outcome ("stage succeeded — results pushed to branch …").
 */
export interface StatusItem {
  kind: "status";
  id: number;
  at: number;
  text: string;
}
export interface ErrorItem {
  kind: "error";
  id: number;
  message: string;
}

export type ChatItem =
  | UserItem
  | AgentItem
  | ThoughtItem
  | ToolItem
  | PlanItem
  | PermissionItem
  | AskItem
  | NoticeItem
  | StatusItem
  | ErrorItem;

/** The agent's active turn, as goose announces it on the run's session. */
export interface ActiveRun {
  runId: string;
}

/**
 * Live spend counters for the run's session, folded from goose's usage
 * notices. These are the units the coming run limits are measured in
 * (agentic-controller#115: maxTurns via GOOSE_MAX_TURNS, maxCost).
 */
export interface RunUsage {
  /** Tokens occupying the context window right now. Absent until the
   * provider reports a real figure -- goose on Bedrock only ever says 0,
   * which in the header read as a measurement. */
  used?: number;
  contextLimit?: number;
  /** Accumulated over the session. */
  inputTokens?: number;
  outputTokens?: number;
  /** Accumulated cost as goose reports it (usage_update.accumulatedCost). */
  cost?: number;
  /** Per-response costs summed (message_usage) — the fallback when goose
   * reports no accumulated figure. */
  summedCost?: number;
  currency?: string;
}

// -------------------------------------------------- session/update mapping

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Text of an ACP content block ({type:"text", text}). */
function contentText(content: unknown): string {
  if (
    isRecord(content) &&
    content.type === "text" &&
    typeof content.text === "string"
  ) {
    return content.text;
  }
  return "";
}

/** goose's vendor metadata on an update (`_meta.goose`), or {}. */
export function gooseMeta(u: SessionUpdate): Record<string, unknown> {
  return isRecord(u._meta) && isRecord(u._meta.goose) ? u._meta.goose : {};
}

/** Id goose stamps on a streamed message; a steer pickup carries the steer's. */
export function updateMessageId(u: SessionUpdate): string | undefined {
  return str(gooseMeta(u).messageId) || str(u.messageId) || undefined;
}

const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * Fold a usage notice into the running counters. goose's custom
 * `usage_update` (customNotifications) carries used / contextLimit /
 * accumulatedInputTokens / accumulatedOutputTokens / accumulatedCost; the
 * standard ACP one it also emits at prompt end carries used / size /
 * cost.{amount,currency}. `message_usage` is one per model response.
 */
export function mergeUsage(prev: RunUsage | null, u: SessionUpdate): RunUsage {
  const base: RunUsage = prev ?? {};
  if (u.sessionUpdate === "message_usage") {
    const usage = isRecord(u.usage) ? u.usage : {};
    const cost = num(usage.cost);
    return {
      ...base,
      summedCost:
        cost === undefined ? base.summedCost : (base.summedCost ?? 0) + cost,
    };
  }
  const cost = isRecord(u.cost) ? u.cost : undefined;
  return {
    ...base,
    // A context that has held a prompt is never empty: 0 is a provider that
    // does not meter occupancy (goose on Bedrock), not a reading.
    used: num(u.used) || base.used,
    contextLimit: num(u.contextLimit) ?? num(u.size) ?? base.contextLimit,
    inputTokens: num(u.accumulatedInputTokens) ?? base.inputTokens,
    outputTokens: num(u.accumulatedOutputTokens) ?? base.outputTokens,
    cost: num(u.accumulatedCost) ?? num(cost?.amount) ?? base.cost,
    currency: str(cost?.currency) || base.currency,
  };
}

/** The {type, message} of a status_message update, if well-formed. */
export function statusMessageOf(
  u: SessionUpdate
): { type: string; message: string } | undefined {
  if (u.sessionUpdate !== "status_message") return undefined;
  const status = isRecord(u.status) ? u.status : {};
  const message = str(status.message);
  return message ? { type: str(status.type), message } : undefined;
}

/** Text carried by tool_call_update.content: [{type:"content", content:{...}}]. */
function toolUpdateText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((c) =>
      isRecord(c) && c.type === "content" ? contentText(c.content) : ""
    )
    .filter(Boolean)
    .join("\n");
}

/** Pure reducer from an ACP session/update onto the chat item list. */
export function reduceUpdate(
  items: ChatItem[],
  u: SessionUpdate,
  nextId: () => number
): ChatItem[] {
  switch (u.sessionUpdate) {
    case "agent_message_chunk": {
      const text = contentText(u.content);
      if (!text) return items;
      const last = items[items.length - 1];
      if (last && last.kind === "agent") {
        return [...items.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [...items, { kind: "agent", id: nextId(), at: Date.now(), text }];
    }
    case "agent_thought_chunk": {
      const text = contentText(u.content);
      if (!text) return items;
      const last = items[items.length - 1];
      if (last && last.kind === "thought") {
        return [...items.slice(0, -1), { ...last, text: last.text + text }];
      }
      return [
        ...items,
        { kind: "thought", id: nextId(), at: Date.now(), text },
      ];
    }
    case "plan": {
      const entries: PlanEntry[] = Array.isArray(u.entries)
        ? u.entries
            .filter(isRecord)
            .map((e) => ({
              content: str(e.content),
              status: str(e.status) || "pending",
            }))
            .filter((e) => e.content)
        : [];
      if (entries.length === 0) return items;
      // Each plan update carries the whole ladder -- replace in place.
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it && it.kind === "plan") {
          const next: PlanItem = { ...it, entries };
          return [...items.slice(0, i), next, ...items.slice(i + 1)];
        }
      }
      return [...items, { kind: "plan", id: nextId(), entries }];
    }
    case "tool_call": {
      return [
        ...items,
        {
          kind: "tool",
          id: nextId(),
          at: Date.now(),
          toolCallId: str(u.toolCallId),
          title: str(u.title),
          status: str(u.status) || "pending",
          detail: toolUpdateText(u.content),
          input: isRecord(u.rawInput) ? u.rawInput : undefined,
        },
      ];
    }
    case "user_message_chunk": {
      // Only redirects are transcript material here: when the running turn
      // picks up a steer, goose echoes it as a user message flagged
      // _meta.goose.steer. Other user chunks are replays of the prompt the
      // harness sent -- the live view is the agent's stream, not the prompt.
      const goose = gooseMeta(u);
      if (goose.steer !== true) return items;
      const text = contentText(u.content);
      const messageId = updateMessageId(u);
      // A redirect this viewer sent already sits in the list: flip it to
      // delivered instead of echoing a second bubble. Match by id, or by
      // text for one whose id has not come back yet.
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (!it || it.kind !== "user" || !it.steer) continue;
        const st = it.steer;
        const knownId = "messageId" in st ? st.messageId : undefined;
        const byId = !!messageId && knownId === messageId;
        const pending = st.state === "sending" || st.state === "queued";
        if (!byId && !(pending && it.text === text)) continue;
        if (st.state === "delivered") {
          // A later chunk of the same pickup: ours is already complete.
          if (!st.streamed || !text) return items;
          return [
            ...items.slice(0, i),
            { ...it, text: it.text + text },
            ...items.slice(i + 1),
          ];
        }
        const next: UserItem = {
          ...it,
          steer: { state: "delivered", messageId: messageId ?? knownId },
        };
        return [...items.slice(0, i), next, ...items.slice(i + 1)];
      }
      if (!text) return items;
      // Another viewer's redirect -- show it.
      return [
        ...items,
        {
          kind: "user",
          id: nextId(),
          at: Date.now(),
          text,
          steer: { state: "delivered", messageId, streamed: true },
        },
      ];
    }
    case "status_message": {
      // Notices are transcript material (the harness's stage outcome
      // rides here); progress lines are transient and handled by the
      // panel, not the transcript.
      const status = statusMessageOf(u);
      if (!status || status.type !== "notice") return items;
      return [
        ...items,
        { kind: "status", id: nextId(), at: Date.now(), text: status.message },
      ];
    }
    case "tool_call_update": {
      const toolCallId = str(u.toolCallId);
      let idx = -1;
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it && it.kind === "tool" && it.toolCallId === toolCallId) {
          idx = i;
          break;
        }
      }
      if (idx < 0) return items;
      const tool = items[idx] as ToolItem;
      const extra = toolUpdateText(u.content);
      const next: ToolItem = {
        ...tool,
        status: str(u.status) || tool.status,
        title: str(u.title) || tool.title,
        detail: extra
          ? tool.detail
            ? `${tool.detail}\n${extra}`
            : extra
          : tool.detail,
      };
      return [...items.slice(0, idx), next, ...items.slice(idx + 1)];
    }
    default:
      return items;
  }
}
