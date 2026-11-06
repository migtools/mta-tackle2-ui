import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tab, TabTitleText, Tabs } from "@patternfly/react-core";

import type {
  AgentResource,
  AgentRun,
  SkillCard,
  SkillCollection,
} from "@app/api/agentic/contract";
import { isTerminalPhase } from "@app/api/agentic/contract";

import { ChatPanel } from "./ChatPanel";
import { RecordedTranscript } from "./recorded-transcript";
import { RunDetailsTab } from "./run-details-tab";
import { RunLogsTab } from "./run-logs-tab";

export type RunPanelTab = "transcript" | "logs" | "details";

/**
 * The run's lower panel: the recorded transcript, the raw container log,
 * and the run's facts, in tabs. The transcript tab is the default; a
 * finished run with nothing recorded (or a run whose mode was never
 * recordable) defaults to the log instead.
 */
export function RunPanel({
  run,
  targetBranch,
  stageInstructions,
  agent,
  skillCards = [],
  skillCollections = [],
  skillsUnresolved,
  tab,
  onTabChange,
}: {
  run: AgentRun;
  /** Target branch of the run, pinned in the transcript header. */
  targetBranch?: string;
  /** The workflow stage's instructions, for the details tab. */
  stageInstructions?: string;
  agent?: AgentResource;
  skillCards?: SkillCard[];
  skillCollections?: SkillCollection[];
  skillsUnresolved?: boolean;
  /** Controlled tab; uncontrolled when omitted. */
  tab?: RunPanelTab;
  onTabChange?: (t: RunPanelTab) => void;
}) {
  const { t } = useTranslation();
  const runName = run.metadata.name ?? "";
  const finished = isTerminalPhase(run.status?.phase);
  const isLive = !finished;
  // Approve/askUser runs are never recorded (the recorder must not change
  // their fail-fast behavior), so their transcript is the live ChatPanel
  // while they run.
  const unrecordedMode =
    run.spec.execution?.mode === "approve" || !!run.spec.execution?.askUser;

  const [ownTab, setOwnTab] = useState<RunPanelTab>("transcript");
  const activeTab = tab ?? ownTab;
  const userPicked = useRef(false);
  const [transcriptStatus, setTranscriptStatus] = useState<
    "recording" | "complete" | "incomplete" | "skipped" | "none" | undefined
  >(undefined);

  const changeTab = (next: RunPanelTab) => {
    userPicked.current = true;
    onTabChange?.(next);
    setOwnTab(next);
  };

  // A finished run whose transcript is absent has nothing to show on the
  // transcript tab: land the viewer on the log instead — but never yank a
  // tab the user chose.
  useEffect(() => {
    if (userPicked.current || !finished) return;
    if (
      transcriptStatus === "none" ||
      transcriptStatus === "skipped" ||
      (unrecordedMode && finished)
    ) {
      setOwnTab("logs");
    }
  }, [finished, transcriptStatus, unrecordedMode]);

  const transcriptBody = (() => {
    if (unrecordedMode) {
      // While it runs, the live panel is the only transcript there is; it
      // also carries the permission prompts that mode exists for.
      if (!finished) {
        return (
          <ChatPanel
            key={run.metadata.name}
            runName={runName}
            status={run.status}
            agentRef={run.spec.agentRef}
            targetBranch={targetBranch}
          />
        );
      }
      return (
        <div className="run-panel-notice">
          {t("agentic.transcript.skipped")}
        </div>
      );
    }
    return (
      <RecordedTranscript
        runName={runName}
        agentRef={run.spec.agentRef}
        isLive={isLive}
        targetBranch={targetBranch}
        onStatus={setTranscriptStatus}
      />
    );
  })();

  return (
    <Tabs
      activeKey={activeTab}
      onSelect={(_e, key) => changeTab(key as RunPanelTab)}
      className="run-panel-tabs"
    >
      <Tab
        eventKey="transcript"
        title={<TabTitleText>{t("agentic.runPanel.transcript")}</TabTitleText>}
      >
        {transcriptBody}
      </Tab>
      <Tab
        eventKey="logs"
        title={<TabTitleText>{t("agentic.runPanel.logs")}</TabTitleText>}
      >
        <RunLogsTab runName={runName} isLive={isLive} />
      </Tab>
      <Tab
        eventKey="details"
        title={<TabTitleText>{t("agentic.runPanel.details")}</TabTitleText>}
      >
        <RunDetailsTab
          run={run}
          stageInstructions={stageInstructions}
          agent={agent}
          skillCards={skillCards}
          skillCollections={skillCollections}
          skillsUnresolved={skillsUnresolved}
        />
      </Tab>
    </Tabs>
  );
}
