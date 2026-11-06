import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardBody, CardTitle, Label } from "@patternfly/react-core";
import {
  CheckCircleIcon,
  ExclamationCircleIcon,
  PendingIcon,
} from "@patternfly/react-icons";

import type {
  AgentRun,
  AgentRunPhase,
  AgentWorkflowRunStageStatus,
} from "@app/api/agentic/contract";
import { isTerminalPhase } from "@app/api/agentic/contract";
import { PhaseLabel } from "@app/pages/agent-runs/components/PhaseLabel";
import { formatDuration } from "@app/utils/agentic";

/**
 * The stage a viewer lands on: the one running, else the one that failed,
 * else the last that has a run, else the first. The failed stage wins over
 * later stages because it is the thing to look at.
 */
export function defaultStage(
  stages: AgentWorkflowRunStageStatus[],
  currentStage?: string
): string {
  const running = stages.find(
    (s) => s.phase === "Running" || s.name === currentStage
  );
  if (running) return running.name;
  const failed = stages.findLast((s) => s.phase === "Failed");
  if (failed) return failed.name;
  const withRun = stages.findLast((s) => !!s.agentRunName);
  if (withRun) return withRun.name;
  return stages[0]?.name ?? "";
}

/**
 * Seconds a stage's child run has taken (or is taking), whole seconds from
 * its own timestamps; ticks are driven by the caller's re-render.
 */
export function stageDuration(now: number, run?: AgentRun): number | undefined {
  const start = run?.status?.startTime;
  if (!start) return undefined;
  const end = run?.status?.completionTime
    ? Date.parse(run.status.completionTime)
    : isTerminalPhase(run?.status?.phase)
      ? undefined
      : now;
  if (end === undefined) return undefined;
  const seconds = Math.max(0, Math.round((end - Date.parse(start)) / 1000));
  return seconds;
}

/**
 * One card per workflow stage: status, agent, duration — click to bring
 * the stage's run panel up. The selected card is outlined.
 */
export function StageCards({
  stages,
  runs,
  selected,
  onSelect,
}: {
  stages: AgentWorkflowRunStageStatus[];
  /** Child AgentRuns by agentRunName; a stage may not have one yet. */
  runs: Record<string, AgentRun | undefined>;
  selected: string;
  onSelect: (stage: string) => void;
}) {
  const { t } = useTranslation();
  // A 1s tick while any stage runs, so durations move. `now` lives in
  // state (set only from the timer) so render stays pure.
  const anyRunning = stages.some((s) => s.phase === "Running");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [anyRunning]);

  return (
    <div className="stage-cards">
      {stages.map((stage) => {
        const run = stage.agentRunName ? runs[stage.agentRunName] : undefined;
        const duration = stageDuration(now, run);
        const isSelected = stage.name === selected;
        return (
          <Card
            key={stage.name}
            id={`stage-card-${stage.name}`}
            isSelectable
            isSelected={isSelected}
            onClick={() => onSelect(stage.name)}
            className={`stage-card${isSelected ? " stage-card-selected" : ""}`}
          >
            <CardTitle>
              <StageStatusIcon phase={stage.phase} />
              <span className="stage-card-name">{stage.name}</span>
              <PhaseLabel phase={stage.phase} />
            </CardTitle>
            <CardBody>
              <div className="stage-card-agent">
                {stage.agentRunName ? (
                  <Label variant="outline">
                    {run?.spec.agentRef ?? stage.agentRef ?? stage.agentRunName}
                  </Label>
                ) : (
                  <span className="stage-card-not-started">
                    {t("agentic.workflowRuns.notStarted")}
                  </span>
                )}
              </div>
              <div className="stage-card-duration">
                {duration !== undefined ? formatDuration(duration) : "-"}
              </div>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}

function StageStatusIcon({ phase }: { phase?: AgentRunPhase }) {
  switch (phase) {
    case "Succeeded":
      return <CheckCircleIcon className="stage-icon-success" />;
    case "Failed":
      return <ExclamationCircleIcon className="stage-icon-failed" />;
    default:
      return <PendingIcon className="stage-icon-pending" />;
  }
}
