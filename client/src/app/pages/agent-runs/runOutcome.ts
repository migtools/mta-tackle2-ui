import type { HarnessTerminationData } from "@app/api/agentic/contract";

/**
 * ACP stop reasons that only say how the agent's last turn ended, not that
 * anything went wrong. A run that stops on one of these has no failure to
 * report, so they never reach the viewer as a reason.
 */
const BENIGN_STOP_REASONS = new Set([
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
]);

/**
 * The harness's `stopReason` when it explains a failure, or undefined when
 * it only records how the turn ended (see BENIGN_STOP_REASONS).
 */
export function failureStopReason(
  terminationData?: HarnessTerminationData
): string | undefined {
  const stopReason = terminationData?.stopReason;
  if (typeof stopReason !== "string") return undefined;
  const text = stopReason.trim();
  if (!text || BENIGN_STOP_REASONS.has(text)) return undefined;
  return text;
}

/** Strips C0 control characters other than newline from text. */
function stripControlChars(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B-\x1F\x7F]/g, "");
}

/**
 * The readable part of a termination message. The controller copies the
 * agent container's whole termination log into the Succeeded condition, and
 * the Konveyor harness writes that as JSON (agentic-controller#189) — whose
 * `stopReason` is the only sentence worth showing. Workflow-run conditions
 * prefix the JSON with their own sentence ("Stage "execute" did not
 * succeed: {…}"); the prefix keeps its meaning next to the unwrapped
 * reason. Returns undefined for anything that is not such a JSON object,
 * so callers keep their own text.
 */
export function unwrapStopReason(message?: string): string | undefined {
  if (typeof message !== "string") return undefined;
  const text = stripControlChars(message).trim();
  // Find the JSON object, bare or after a prefix ending in ": ".
  let json = text;
  let prefix = "";
  if (!text.startsWith("{")) {
    const at = text.indexOf("{");
    if (at < 0 || !text.slice(0, at).trimEnd().endsWith(":")) return undefined;
    prefix = text.slice(0, at).trim();
    json = text.slice(at);
  }
  if (!json.endsWith("}")) return undefined;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const stopReason = (parsed as HarnessTerminationData).stopReason;
    if (typeof stopReason !== "string" || !stopReason.trim()) return undefined;
    const reason = stripControlChars(stopReason).trim();
    return prefix ? `${prefix} ${reason}` : reason;
  } catch {
    return undefined;
  }
}

/**
 * Markers of a run that did its work and then could not write to the
 * repository: today go-git's own wording, reached through the harness's
 * "final push: …" reason; `git write access:` is the stable prefix the
 * harness is to put in front of it (konveyor/agentic-controller#247).
 * Either one identifies the failure, so this keeps working once it lands.
 */
const GIT_WRITE_ACCESS_MARKERS = [
  "git write access:",
  "authentication required",
  "no anonymous write access",
];

/**
 * True when a terminal run's reason is the repository refusing the agent's
 * push — the one failure whose fix is a credential rather than a retry.
 * Exported for any page that needs to say so (the run page says it after
 * the fact; the create-run modal can warn before, konveyor/tackle2-ui#3616).
 */
export function isGitWriteAccessFailure(reason?: string): boolean {
  if (typeof reason !== "string") return false;
  const text = reason.toLowerCase();
  return GIT_WRITE_ACCESS_MARKERS.some((marker) => text.includes(marker));
}
