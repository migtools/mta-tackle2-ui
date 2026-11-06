import React, { useState } from "react";
import { AxiosError } from "axios";
import { Trans, useTranslation } from "react-i18next";
import { useHistory, useLocation, useParams } from "react-router-dom";
import {
  Alert,
  Bullseye,
  Button,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  PageSection,
  Spinner,
} from "@patternfly/react-core";
import { RedoIcon } from "@patternfly/react-icons";

import type { WorkflowRunDetailsRoute } from "@app/Paths";
import { DevPaths } from "@app/Paths";
import type {
  AgentRun,
  AgentWorkflowRunStageStatus,
  ExecutionMode,
} from "@app/api/agentic/contract";
import { isTerminalPhase, runHubCoordinates } from "@app/api/agentic/contract";
import { useHasSomeScopes } from "@app/auth";
import { AgenticFetchError } from "@app/components/AgenticFetchError";
import { PageHeader } from "@app/components/PageHeader";
import { BranchPanel } from "@app/pages/agent-runs/components/BranchPanel";
import { PhaseLabel } from "@app/pages/agent-runs/components/PhaseLabel";
import { RunConditionSummary } from "@app/pages/agent-runs/components/RunConditionSummary";
import { RunPanel } from "@app/pages/agent-runs/components/run-panel";
import { useFetchAgentRunsByNames } from "@app/queries/agent-runs";
import { useFetchApplications } from "@app/queries/applications";
import { useFetchWorkflowRun } from "@app/queries/workflow-runs";
import { agenticWorkflowRunsCreateScopes } from "@app/scopes";
import {
  formatAge,
  formatDuration,
  runBelongsToApplication,
  workflowRunDuration,
} from "@app/utils/agentic";
import { formatPath } from "@app/utils/utils";

import { CreateWorkflowRunModal } from "./components/CreateWorkflowRunModal";
import { StageCards, defaultStage } from "./components/stage-cards";

import "@app/pages/agent-runs/agent-runs.css";

/**
 * Supervision mode the selected stage actually runs under. The controller
 * resolves the workflow stage's `execution` into the stage's own AgentRun
 * spec, so that AgentRun is the authoritative value; the stage status is
 * the fallback while the AgentRun is still loading. Absent or unrecognized
 * means `auto`, matching the create-run modal's
 * `prefill?.spec.execution?.mode ?? "auto"`.
 *
 * Tool-call approval is the only viewer-required condition today. If
 * `execution.askUser` ever reaches the stage spec it needs its own notice
 * (an unanswered question fails the run) — a separate check, not this one.
 */
function resolveExecutionMode(
  stage?: AgentWorkflowRunStageStatus,
  agentRun?: AgentRun
): ExecutionMode {
  const mode = agentRun?.spec.execution?.mode ?? stage?.execution?.mode;
  return mode === "approve" ? "approve" : "auto";
}

const WorkflowRunDetailPage: React.FC = () => {
  const { t } = useTranslation();
  const history = useHistory();
  const location = useLocation();
  const { runName } = useParams<WorkflowRunDetailsRoute>();
  const { workflowRun, isLoading, fetchError } = useFetchWorkflowRun(runName);
  const workflowFinished = isTerminalPhase(workflowRun?.status?.phase);
  const stages = workflowRun?.status?.stages ?? [];
  const currentStage = workflowRun?.status?.currentStage;
  // The selected stage lives in ?stage=; without it, land on the stage a
  // viewer is here for (running, else failed, else the newest with a run).
  const stageParam = new URLSearchParams(location.search).get("stage");
  const selected =
    stages.find((s) => s.name === stageParam)?.name ??
    defaultStage(stages, workflowFinished ? undefined : currentStage);
  const selectedStage = stages.find((s) => s.name === selected);
  const selectedRunName = selectedStage?.agentRunName ?? "";
  // All stages' child runs, in parallel: the cards show each stage's
  // agent and duration, the panel shows the selected one's.
  const { runs } = useFetchAgentRunsByNames(
    stages.map((s) => s.agentRunName ?? "").filter(Boolean)
  );
  const selectedRun = selectedRunName ? runs[selectedRunName] : undefined;
  const selectedLive = !workflowFinished && selectedStage?.phase === "Running";
  const stageMode = resolveExecutionMode(selectedStage, selectedRun);
  // "Run again": the spec is immutable and the hub has no delete, so a
  // prefilled create is the one re-run shape there is.
  const canCreate = useHasSomeScopes(agenticWorkflowRunsCreateScopes);
  const [rerunOpen, setRerunOpen] = useState(false);
  // Inventory failures leave `application` undefined — BranchPanel copes.
  const { data: applications } = useFetchApplications();

  const breadcrumbs = [
    { title: t("terms.workflowRuns"), path: DevPaths.workflowRuns },
    { title: runName },
  ];

  const selectStage = (stage: string) => {
    history.replace({
      pathname: location.pathname,
      search: stage ? `?stage=${encodeURIComponent(stage)}` : "",
    });
  };

  if (isLoading && !workflowRun) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner aria-label={t("agentic.workflowRuns.loadingRun")} />
        </Bullseye>
      </PageSection>
    );
  }

  if (!workflowRun) {
    const isNotFound =
      !fetchError ||
      (fetchError instanceof AxiosError && fetchError.response?.status === 404);
    return (
      <>
        <PageSection hasBodyWrapper={false}>
          <PageHeader title={runName} breadcrumbs={breadcrumbs} />
        </PageSection>
        <PageSection>
          {isNotFound ? (
            <Alert
              variant="warning"
              isInline
              title={t("agentic.workflowRuns.notFoundTitle")}
            >
              <Trans
                i18nKey="agentic.workflowRuns.notFoundBody"
                values={{ name: runName }}
              />
            </Alert>
          ) : (
            <AgenticFetchError error={fetchError} />
          )}
        </PageSection>
      </>
    );
  }

  const coordinates = runHubCoordinates(workflowRun.spec.env);
  const application = applications.find((a) =>
    runBelongsToApplication(workflowRun, a.id)
  );
  const finished = workflowFinished;

  return (
    <>
      <PageSection hasBodyWrapper={false}>
        <PageHeader
          title={runName}
          breadcrumbs={breadcrumbs}
          description={
            <span className="run-phase-line">
              <PhaseLabel phase={workflowRun.status?.phase} />
              <RunConditionSummary
                conditions={workflowRun.status?.conditions}
                phase={workflowRun.status?.phase}
              />
            </span>
          }
          btnActions={
            finished && canCreate ? (
              <Button
                variant="secondary"
                icon={<RedoIcon />}
                onClick={() => setRerunOpen(true)}
              >
                {t("actions.runAgain")}
              </Button>
            ) : undefined
          }
        />
        {fetchError && (
          <Alert
            variant="warning"
            isInline
            title={t("agentic.workflowRuns.refreshErrorTitle")}
            style={{ marginTop: "0.5rem" }}
          >
            {fetchError instanceof Error
              ? fetchError.message
              : String(fetchError)}
          </Alert>
        )}
        <DescriptionList
          isHorizontal
          isCompact
          columnModifier={{ default: "2Col" }}
          style={{ marginTop: "1rem" }}
        >
          <DescriptionListGroup>
            <DescriptionListTerm>{t("terms.workflow")}</DescriptionListTerm>
            <DescriptionListDescription>
              {workflowRun.spec.workflowRef}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>
              {t("agentic.workflowRuns.currentStage")}
            </DescriptionListTerm>
            <DescriptionListDescription>
              {currentStage ?? "-"}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t("terms.age")}</DescriptionListTerm>
            <DescriptionListDescription>
              {formatAge(workflowRun.metadata.creationTimestamp)}
            </DescriptionListDescription>
          </DescriptionListGroup>
          <DescriptionListGroup>
            <DescriptionListTerm>{t("terms.duration")}</DescriptionListTerm>
            <DescriptionListDescription>
              {formatDuration(workflowRunDuration(workflowRun))}
            </DescriptionListDescription>
          </DescriptionListGroup>
        </DescriptionList>
      </PageSection>
      <PageSection>
        <Content>
          <Content component="h2">{t("terms.stages")}</Content>
        </Content>
        {stages.length === 0 ? (
          <Alert
            variant="info"
            isInline
            title={t("agentic.workflowRuns.noStageStatusTitle")}
          >
            {t("agentic.workflowRuns.noStageStatusBody")}
          </Alert>
        ) : (
          <StageCards
            stages={stages}
            runs={runs}
            selected={selected}
            onSelect={selectStage}
          />
        )}

        {coordinates.targetBranch && (
          <BranchPanel
            application={application}
            targetBranch={coordinates.targetBranch}
            isTerminal={finished}
          />
        )}
      </PageSection>
      <PageSection
        isFilled
        hasBodyWrapper={false}
        className="run-detail-chat-section"
        padding={{ default: "padding" }}
      >
        {selectedLive &&
          (stageMode === "approve" ? (
            <Alert
              variant="warning"
              isInline
              title={t("agentic.workflowRuns.approvalViewerTitle")}
              style={{ marginBottom: "1rem" }}
            >
              {t("agentic.workflowRuns.approvalViewerBody", {
                stage: selectedStage?.name,
              })}
            </Alert>
          ) : (
            <Alert
              variant="info"
              isInline
              isPlain
              title={t("agentic.workflowRuns.autoModeViewerNote", {
                stage: selectedStage?.name,
              })}
              style={{ marginBottom: "1rem" }}
            />
          ))}
        {selectedRun ? (
          <RunPanel
            key={selectedRunName}
            run={selectedRun}
            stageInstructions={selectedStage?.instructions}
            targetBranch={coordinates.targetBranch}
          />
        ) : selectedRunName ? (
          <Bullseye>
            <Spinner aria-label={t("agentic.workflowRuns.loadingLiveStage")} />
          </Bullseye>
        ) : (
          selectedStage && (
            <div className="stage-not-started">
              {selectedStage.instructions && (
                <pre className="run-details-instructions">
                  {selectedStage.instructions}
                </pre>
              )}
              <div>{t("agentic.workflowRuns.stageNotStarted")}</div>
            </div>
          )
        )}
      </PageSection>
      {rerunOpen && (
        <CreateWorkflowRunModal
          prefill={workflowRun}
          onClose={() => setRerunOpen(false)}
          onCreated={(name) => {
            setRerunOpen(false);
            history.push(
              formatPath(DevPaths.workflowRunDetails, { runName: name })
            );
          }}
        />
      )}
    </>
  );
};

export default WorkflowRunDetailPage;
