import { useTranslation } from "react-i18next";
import {
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
} from "@patternfly/react-core";
import { Table, Tbody, Td, Th, Thead, Tr } from "@patternfly/react-table";

import type {
  AgentResource,
  AgentRun,
  SkillCard,
  SkillCollection,
} from "@app/api/agentic/contract";
import { formatDuration } from "@app/utils/agentic";

import { RunSkillsSummary } from "./RunSkillsSummary";

/**
 * The run's own facts: what it was asked to do, how long it took, what the
 * controller observed, and what it spent. Everything a triage wants that
 * is not the transcript or the raw log.
 */
export function RunDetailsTab({
  run,
  stageInstructions,
  agent,
  skillCards,
  skillCollections,
  skillsUnresolved,
}: {
  run: AgentRun;
  /** The workflow stage's instructions, shown when they framed the run. */
  stageInstructions?: string;
  agent?: AgentResource;
  skillCards: SkillCard[];
  skillCollections: SkillCollection[];
  skillsUnresolved?: boolean;
}) {
  const { t } = useTranslation();
  const status = run.status;
  const conditions = status?.conditions ?? [];
  const instructions = stageInstructions ?? run.spec.instructions;
  const usage = status?.terminationData?.usage;

  return (
    <div className="run-details-tab">
      <DescriptionList
        isHorizontal
        isCompact
        columnModifier={{ default: "2Col" }}
      >
        <DescriptionListGroup>
          <DescriptionListTerm>{t("terms.agent")}</DescriptionListTerm>
          <DescriptionListDescription>
            {run.spec.agentRef}
          </DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>{t("terms.skills")}</DescriptionListTerm>
          <DescriptionListDescription>
            <RunSkillsSummary
              agent={agent}
              skillCards={skillCards}
              skillCollections={skillCollections}
              variant="inline"
              unresolved={skillsUnresolved}
            />
          </DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>
            {t("agentic.runPanel.runName")}
          </DescriptionListTerm>
          <DescriptionListDescription>
            <code>{run.metadata.name}</code>
          </DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>
            {t("agentic.runPanel.started")}
          </DescriptionListTerm>
          <DescriptionListDescription>
            {status?.startTime
              ? new Date(status.startTime).toLocaleString()
              : "-"}
          </DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>
            {t("agentic.runPanel.ended")}
          </DescriptionListTerm>
          <DescriptionListDescription>
            {status?.completionTime
              ? new Date(status.completionTime).toLocaleString()
              : "-"}
          </DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>
            {t("agentic.runPanel.duration")}
          </DescriptionListTerm>
          <DescriptionListDescription>
            {formatDuration(status?.duration)}
          </DescriptionListDescription>
        </DescriptionListGroup>
        <DescriptionListGroup>
          <DescriptionListTerm>
            {t("agentic.runPanel.instructions")}
          </DescriptionListTerm>
          <DescriptionListDescription>
            {instructions ? (
              <pre className="run-details-instructions">{instructions}</pre>
            ) : (
              "-"
            )}
          </DescriptionListDescription>
        </DescriptionListGroup>
        {usage && (
          <DescriptionListGroup>
            <DescriptionListTerm>
              {t("agentic.runPanel.usage")}
            </DescriptionListTerm>
            <DescriptionListDescription>
              {[
                usage.turnsUsed !== undefined
                  ? t("agentic.chat.failureUsageTurns", {
                      count: usage.turnsUsed,
                    })
                  : null,
                usage.contextUsed !== undefined
                  ? usage.contextSize
                    ? t("agentic.chat.usageContext", {
                        used: usage.contextUsed.toLocaleString(),
                        limit: usage.contextSize.toLocaleString(),
                        percent: Math.round(
                          (usage.contextUsed / usage.contextSize) * 100
                        ),
                      })
                    : t("agentic.chat.usageContextUnbounded", {
                        used: usage.contextUsed.toLocaleString(),
                      })
                  : null,
                usage.cost !== undefined
                  ? t("agentic.chat.usageCost", {
                      amount: usage.cost.toFixed(4),
                    })
                  : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </DescriptionListDescription>
          </DescriptionListGroup>
        )}
      </DescriptionList>
      <Table aria-label={t("agentic.runPanel.conditions")} variant="compact">
        <Thead>
          <Tr>
            <Th>{t("agentic.runPanel.conditionType")}</Th>
            <Th>{t("agentic.runPanel.conditionStatus")}</Th>
            <Th>{t("agentic.runPanel.conditionReason")}</Th>
            <Th>{t("agentic.runPanel.conditionMessage")}</Th>
          </Tr>
        </Thead>
        <Tbody>
          {conditions.map((c, i) => (
            <Tr key={i}>
              <Td>{c.type}</Td>
              <Td>{c.status}</Td>
              <Td>{c.reason ?? "-"}</Td>
              <Td>{c.message ?? "-"}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}
