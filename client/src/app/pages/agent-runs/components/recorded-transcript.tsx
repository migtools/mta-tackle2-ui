import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  Chatbot,
  ChatbotAlert,
  ChatbotContent,
  ChatbotHeader,
  ChatbotHeaderActions,
  ChatbotHeaderMain,
  ChatbotHeaderTitle,
  MessageBox,
  MessageDivider,
} from "@patternfly/chatbot";
import { Label, Spinner } from "@patternfly/react-core";
import { CodeBranchIcon } from "@patternfly/react-icons";

import {
  replayTranscript,
  streamAgentRunTranscript,
} from "@app/api/rest/agent-run-streams";
import type {
  RecordedLine,
  StreamStatus,
} from "@app/api/rest/agent-run-streams";

import type { ChatItem } from "../transcript/transcript-model";
import { useChatAutoScroll } from "../useChatAutoScroll";

import { ChatItemView, PinnedPlan, UsageBadge } from "./ChatPanel";

import "@patternfly/chatbot/dist/css/main.css";
import "../agent-runs.css";

/**
 * The recorded transcript of an agent run, replayed from the hub's
 * transcript.jsonl. The same message views as the live ChatPanel, in the
 * same chatbot shell but without a footer — nothing here can steer the
 * run, it already happened.
 */
export function RecordedTranscript({
  runName,
  agentRef,
  isLive,
  targetBranch,
  onStatus,
}: {
  runName: string;
  agentRef?: string;
  isLive: boolean;
  targetBranch?: string;
  /** The hub's transcript status, surfaced for the panel's default tab. */
  onStatus?: (s: StreamStatus["transcript"]) => void;
}) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<RecordedLine[]>([]);
  const [status, setStatus] = useState<StreamStatus>({});
  const [error, setError] = useState<string | null>(null);
  const { messageBoxRef, pinToBottom } = useChatAutoScroll();

  useEffect(() => {
    const controller = new AbortController();
    setLines([]);
    (async () => {
      try {
        await streamAgentRunTranscript(runName, {
          follow: true,
          onLine: (line) => {
            if (controller.signal.aborted) return;
            setLines((prev) => [...prev, line]);
          },
          onStatus: (s) => {
            if (controller.signal.aborted) return;
            setStatus(s);
            if (s.transcript) onStatus?.(s.transcript);
          },
          signal: controller.signal,
          isLive: () => isLive,
        });
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();
    return () => controller.abort();
  }, [runName, isLive, onStatus]);

  const replay = useMemo(() => replayTranscript(lines), [lines]);
  const plan = replay.items.findLast((it) => it.kind === "plan");
  const transcript = plan
    ? replay.items.filter((it) => it.kind !== "plan")
    : replay.items;

  // Interleave the gap dividers after the item they follow.
  const rendered: ReactNode[] = [];
  const gapAfter = (id: number) =>
    replay.gaps.filter((g) => g.afterItemId === id);
  const pushItem = (item: ChatItem) => {
    rendered.push(
      <ChatItemView
        key={item.id}
        item={item}
        botName={agentRef ?? t("agentic.chat.agentName")}
        userName={t("agentic.chat.you")}
        onPermission={() => undefined}
        onAsk={() => undefined}
      />
    );
    for (const gap of gapAfter(item.id)) {
      rendered.push(
        <MessageDivider
          key={`gap-${gap.from}-${gap.to}`}
          content={t("agentic.transcript.gap", {
            minutes: gapMinutes(gap.from, gap.to),
          })}
        />
      );
    }
  };
  for (const item of transcript) pushItem(item);
  // A gap before the first item (-1) renders at the top.
  for (const gap of gapAfter(-1)) {
    rendered.unshift(
      <MessageDivider
        key={`gap-${gap.from}-${gap.to}`}
        content={t("agentic.transcript.gap", {
          minutes: gapMinutes(gap.from, gap.to),
        })}
      />
    );
  }

  const botName = agentRef ?? t("agentic.chat.agentName");
  const chatbot = (
    <Chatbot className="agent-run-chatbot" ariaLabel={t("agentic.chat.title")}>
      <ChatbotHeader>
        <ChatbotHeaderMain>
          <ChatbotHeaderTitle>
            <span className="agent-run-chatbot-title">{botName}</span>
          </ChatbotHeaderTitle>
        </ChatbotHeaderMain>
        <ChatbotHeaderActions>
          {replay.usage && <UsageBadge usage={replay.usage} />}
          {targetBranch && (
            <Label variant="outline" icon={<CodeBranchIcon />}>
              <code>{targetBranch}</code>
            </Label>
          )}
        </ChatbotHeaderActions>
      </ChatbotHeader>
      {plan && plan.kind === "plan" && <PinnedPlan entries={plan.entries} />}
      <ChatbotContent>
        <MessageBox
          ref={messageBoxRef}
          onScrollToBottomClick={pinToBottom}
          ariaLabel={t("agentic.chat.title")}
        >
          {rendered}
          {status.transcript === "recording" && (
            <div className="chat-conn-notice" role="status">
              <Spinner size="sm" aria-label={t("agentic.transcript.loading")} />{" "}
              <span>{t("agentic.transcript.loading")}</span>
            </div>
          )}
          {status.transcript === "none" && (
            <ChatbotAlert variant="info" title={t("agentic.transcript.none")} />
          )}
          {status.transcript === "skipped" && (
            <ChatbotAlert
              variant="info"
              title={t("agentic.transcript.skipped")}
            />
          )}
          {error && (
            <ChatbotAlert variant="danger" title={t("agentic.chat.chatError")}>
              {error}
            </ChatbotAlert>
          )}
        </MessageBox>
      </ChatbotContent>
    </Chatbot>
  );
  return chatbot;
}

/** Whole minutes between the two gap timestamps, at least 1. */
function gapMinutes(from: string, to: string): number {
  const ms = Date.parse(to) - Date.parse(from);
  if (Number.isNaN(ms) || ms <= 0) return 1;
  return Math.max(1, Math.round(ms / 60_000));
}
