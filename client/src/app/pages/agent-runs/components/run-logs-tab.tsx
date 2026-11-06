import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  Button,
  ButtonVariant,
  Label,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
  Tooltip,
} from "@patternfly/react-core";
import {
  CompressIcon,
  DownloadIcon,
  ExpandIcon,
  PlayIcon,
} from "@patternfly/react-icons";

import { streamAgentRunLogs } from "@app/api/rest/agent-run-streams";
import type { StreamStatus } from "@app/api/rest/agent-run-streams";

import { ansiToSpans } from "./ansi";

/** Only the last N lines render; older ones are download-only. */
const MAX_RENDERED_LINES = 5000;
/** Scrolling further than this from the bottom pauses follow. */
const FOLLOW_THRESHOLD_PX = 40;

/**
 * The raw container log of an agent run: a dark terminal-style viewer with
 * a live tail while the run runs, and the hub's saved recording after the
 * pod is gone. The stream re-arms itself from its byte offset while the
 * run is live, so the route's idle cut is invisible.
 */
export function RunLogsTab({
  runName,
  isLive,
}: {
  runName: string;
  isLive: boolean;
}) {
  const { t } = useTranslation();
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<StreamStatus>({});
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    let buffered = "";
    (async () => {
      try {
        await streamAgentRunLogs(runName, {
          follow: true,
          onChunk: (text) => {
            // Chunks can arrive after the effect cleaned up (e.g. StrictMode
            // remount): late data from an aborted stream must not render.
            if (controller.signal.aborted) return;
            buffered += text;
            const complete = buffered.split("\n");
            buffered = complete.pop() ?? "";
            if (complete.length > 0) {
              setLines((prev) => [...prev, ...complete]);
            }
          },
          onStatus: setStatus,
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
  }, [runName, isLive]);

  // Pin to the bottom while following.
  useEffect(() => {
    if (following && scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [lines, following]);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setFollowing(fromBottom <= FOLLOW_THRESHOLD_PX);
  };

  const resumeFollow = () => {
    setFollowing(true);
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  const shown = useMemo(
    () =>
      lines.length > MAX_RENDERED_LINES
        ? lines.slice(lines.length - MAX_RENDERED_LINES)
        : lines,
    [lines]
  );

  const download = () => {
    const blob = new Blob([lines.join("\n") + "\n"], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${runName}-agent.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const body = (
    <div className="run-logs">
      <Toolbar>
        <ToolbarContent>
          <ToolbarGroup>
            <ToolbarItem>
              {status.source === "live" ? (
                <Label color="green">{t("agentic.logs.live")}</Label>
              ) : status.source === "saved" ? (
                <Label color="grey">{t("agentic.logs.saved")}</Label>
              ) : null}
            </ToolbarItem>
            <ToolbarItem>
              <span className="run-logs-count">
                {t("agentic.logs.lineCount", { count: lines.length })}
              </span>
            </ToolbarItem>
            {lines.length > MAX_RENDERED_LINES && (
              <ToolbarItem>
                <span className="run-logs-truncated">
                  {t("agentic.logs.truncated", {
                    shown: MAX_RENDERED_LINES,
                    total: lines.length,
                  })}
                </span>
              </ToolbarItem>
            )}
          </ToolbarGroup>
          <ToolbarGroup>
            <ToolbarItem>
              {!following && (
                <Button
                  variant={ButtonVariant.control}
                  icon={<PlayIcon />}
                  onClick={resumeFollow}
                >
                  {t("agentic.logs.resumeFollow")}
                </Button>
              )}
            </ToolbarItem>
            <ToolbarItem>
              <Button
                variant={ButtonVariant.plain}
                icon={<DownloadIcon />}
                onClick={download}
              >
                {t("agentic.logs.download")}
              </Button>
            </ToolbarItem>
            <ToolbarItem>
              <Tooltip content={t("agentic.logs.fullscreen")}>
                <Button
                  variant={ButtonVariant.plain}
                  aria-label={t("agentic.logs.fullscreen")}
                  icon={expanded ? <CompressIcon /> : <ExpandIcon />}
                  onClick={() => setExpanded((v) => !v)}
                />
              </Tooltip>
            </ToolbarItem>
          </ToolbarGroup>
        </ToolbarContent>
      </Toolbar>
      <div
        ref={scrollerRef}
        role="log"
        className="run-logs-terminal"
        onScroll={onScroll}
      >
        {shown.map((line, i) => (
          <div className="run-logs-line" key={i}>
            {ansiToSpans(line).map((span, j) =>
              span.className ? (
                <span key={j} className={span.className}>
                  {span.text}
                </span>
              ) : (
                <span key={j}>{span.text}</span>
              )
            )}
          </div>
        ))}
        {shown.length === 0 && !error && (
          <div className="run-logs-empty">{t("agentic.logs.empty")}</div>
        )}
        {error && <div className="run-logs-error">{error}</div>}
      </div>
    </div>
  );

  return expanded ? createPortal(body, document.body) : body;
}
