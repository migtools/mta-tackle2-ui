import * as React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import {
  Bullseye,
  CodeBlock,
  CodeBlockCode,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  EmptyState,
  EmptyStateBody,
  ExpandableSection,
  Flex,
  FlexItem,
  Label,
  LabelGroup,
  List,
  ListItem,
  Spinner,
} from "@patternfly/react-core";
import { ExternalLinkAltIcon } from "@patternfly/react-icons";
import spacing from "@patternfly/react-styles/css/utilities/Spacing/spacing";
import {
  ExpandableRowContent,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@patternfly/react-table";

import { DevPaths, Paths } from "@app/Paths";
import { CveFinding, CveStatus } from "@app/api/models";
import { DrawerTabContent } from "@app/components/detail-drawer";
import { useFetchCveFindings, useFetchRhtpaSbom } from "@app/queries/facts";
import { formatPath } from "@app/utils/utils";

import { DecoratedApplication } from "../useDecoratedApplications";

import {
  CveReachabilityDetails,
  CveReachabilitySummary,
} from "./components/cve-reachability";

type LabelColor = React.ComponentProps<typeof Label>["color"];

const severityColor = (severity?: string): LabelColor => {
  switch (severity) {
    case "critical":
      return "red";
    case "high":
      return "orangered";
    case "medium":
      return "orange";
    case "low":
      return "yellow";
    default:
      return "grey";
  }
};

const statusColor: Record<CveStatus, LabelColor> = {
  Detected: "blue",
  Analyzing: "blue",
  Remediated: "green",
  NotAffected: "teal",
  AgentRunning: "purple",
  AgentSucceeded: "green",
  AgentFailed: "red",
  NeedsAttention: "orange",
  Failed: "red",
  PullRequestOpen: "blue",
  PullRequestClosed: "grey",
  Exhausted: "red",
};

const IN_PROGRESS: CveStatus[] = ["Detected", "Analyzing", "AgentRunning"];
const CLOSED: CveStatus[] = ["Remediated", "NotAffected"];

const ExternalLink: React.FC<{ href: string; children: React.ReactNode }> = ({
  href,
  children,
}) => (
  <a href={href} target="_blank" rel="noreferrer">
    {children} <ExternalLinkAltIcon />
  </a>
);

const advisorySource = (source?: string) =>
  source === "redhat-csaf"
    ? "Red Hat CSAF"
    : source === "osv-github"
      ? "GitHub (OSV)"
      : (source ?? "");

export const TabVulnerabilitiesContent: React.FC<{
  application: DecoratedApplication;
}> = ({ application }) => {
  const { t } = useTranslation();
  const { sbom, isFetching: isFetchingSbom } = useFetchRhtpaSbom(
    application.id
  );
  const { findings, isFetching } = useFetchCveFindings(application.id);
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  if (isFetching || isFetchingSbom) {
    return (
      <Bullseye className={spacing.mtLg}>
        <Spinner size="lg" />
      </Bullseye>
    );
  }

  const open = findings.filter((f) => !CLOSED.includes(f.status));

  return (
    <DrawerTabContent>
      <Content className={spacing.mbMd}>
        {sbom ? (
          <Content component="p">
            {t("vulnerabilities.sbomImported", {
              packages: sbom.packages,
              date: new Date(sbom.uploaded).toLocaleString(),
            })}{" "}
            {sbom.consoleUrl && (
              <ExternalLink href={sbom.consoleUrl}>
                {t("vulnerabilities.viewInRhtpa")}
              </ExternalLink>
            )}
          </Content>
        ) : (
          <Content component="p">{t("vulnerabilities.noSbom")}</Content>
        )}
      </Content>

      {findings.length === 0 ? (
        <EmptyState
          titleText={t("vulnerabilities.noneTitle")}
          headingLevel="h4"
          variant="sm"
        >
          <EmptyStateBody>
            {sbom
              ? t("vulnerabilities.noneBody")
              : t("vulnerabilities.noSbomBody")}
          </EmptyStateBody>
        </EmptyState>
      ) : (
        <>
          <LabelGroup className={spacing.mbMd} numLabels={6}>
            <Label color={open.length ? "red" : "green"}>
              {t("vulnerabilities.openCount", { count: open.length })}
            </Label>
            <Label color="green">
              {t("vulnerabilities.remediatedCount", {
                count: findings.length - open.length,
              })}
            </Label>
          </LabelGroup>
          <Table aria-label="Vulnerabilities" variant="compact">
            <Thead>
              <Tr>
                <Th screenReaderText="expand" />
                <Th>{t("vulnerabilities.cve")}</Th>
                <Th>{t("vulnerabilities.package")}</Th>
                <Th>{t("vulnerabilities.reachability")}</Th>
                <Th>{t("vulnerabilities.remediation")}</Th>
              </Tr>
            </Thead>
            {findings.map((f, rowIndex) => (
              <Tbody key={f.cve} isExpanded={!!expanded[f.cve]}>
                <Tr>
                  <Td
                    expand={{
                      rowIndex,
                      isExpanded: !!expanded[f.cve],
                      onToggle: () =>
                        setExpanded({ ...expanded, [f.cve]: !expanded[f.cve] }),
                    }}
                  />
                  <Td dataLabel={t("vulnerabilities.cve")}>
                    <Flex
                      direction={{ default: "column" }}
                      gap={{ default: "gapXs" }}
                    >
                      <FlexItem>
                        {f.consoleUrl ? (
                          <ExternalLink href={f.consoleUrl}>
                            {f.cve}
                          </ExternalLink>
                        ) : (
                          f.cve
                        )}
                      </FlexItem>
                      <FlexItem>
                        <Label isCompact color={severityColor(f.severity)}>
                          {f.severity ?? "unknown"}
                          {f.score ? ` ${f.score.toFixed(1)}` : ""}
                        </Label>
                      </FlexItem>
                    </Flex>
                  </Td>
                  <Td dataLabel={t("vulnerabilities.package")}>
                    <div>{f.package.name}</div>
                    <small>
                      {f.package.version}
                      {f.fixedVersion &&
                        ` → ${f.fixedModule ? `${f.fixedModule} ` : ""}${f.fixedVersion}`}
                    </small>
                  </Td>
                  <Td dataLabel={t("vulnerabilities.reachability")}>
                    <CveReachabilitySummary reachability={f.reachability} />
                  </Td>
                  <Td dataLabel={t("vulnerabilities.remediation")}>
                    <Flex
                      direction={{ default: "column" }}
                      gap={{ default: "gapXs" }}
                    >
                      <FlexItem>
                        <Label
                          isCompact
                          color={statusColor[f.status] ?? "grey"}
                          icon={
                            IN_PROGRESS.includes(f.status) ? (
                              <Spinner size="sm" />
                            ) : undefined
                          }
                        >
                          {t(`vulnerabilities.status.${f.status}`)}
                        </Label>
                      </FlexItem>
                      {(f.attempts ?? 0) > 0 && (
                        <FlexItem>
                          <Label isCompact variant="outline">
                            {t("vulnerabilities.attempts", {
                              count: f.attempts,
                              max: 3,
                            })}
                          </Label>
                        </FlexItem>
                      )}
                      {f.strategy && f.strategy !== "none" && (
                        <FlexItem>
                          <Label isCompact variant="outline">
                            {t(`vulnerabilities.strategy.${f.strategy}`)}
                          </Label>
                        </FlexItem>
                      )}
                      {f.pullRequestUrl && (
                        <FlexItem>
                          <a
                            href={f.pullRequestUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Label isCompact color="blue" isClickable>
                              {t("vulnerabilities.prShort", {
                                number: f.pullRequestNumber,
                              })}
                            </Label>
                          </a>
                        </FlexItem>
                      )}
                    </Flex>
                  </Td>
                </Tr>
                <Tr isExpanded={!!expanded[f.cve]}>
                  <Td colSpan={5}>
                    <ExpandableRowContent>
                      <FindingDetails
                        finding={f}
                        applicationId={application.id}
                      />
                    </ExpandableRowContent>
                  </Td>
                </Tr>
              </Tbody>
            ))}
          </Table>
        </>
      )}
    </DrawerTabContent>
  );
};

const FindingDetails: React.FC<{
  finding: CveFinding;
  applicationId: number;
}> = ({ finding: f, applicationId }) => {
  const { t } = useTranslation();
  return (
    <DescriptionList isCompact>
      {f.title && (
        <DescriptionListGroup>
          <DescriptionListTerm>
            {t("vulnerabilities.summary")}
          </DescriptionListTerm>
          <DescriptionListDescription>
            <strong>{f.title}</strong>
            {f.description && (
              <ExpandableSection
                toggleTextCollapsed={t("vulnerabilities.showDescription")}
                toggleTextExpanded={t("vulnerabilities.hideDescription")}
              >
                {f.description}
              </ExpandableSection>
            )}
          </DescriptionListDescription>
        </DescriptionListGroup>
      )}

      {!!f.advisories?.length && (
        <DescriptionListGroup>
          <DescriptionListTerm>
            {t("vulnerabilities.advisories")}
          </DescriptionListTerm>
          <DescriptionListDescription>
            <List isPlain>
              {f.advisories.map((a) => (
                <ListItem key={a.id}>
                  {a.url ? (
                    <ExternalLink href={a.url}>{a.id}</ExternalLink>
                  ) : (
                    a.id
                  )}{" "}
                  <Label isCompact variant="outline">
                    {advisorySource(a.source)}
                  </Label>
                  {!!a.fixedVersions?.length && (
                    <small>
                      {" "}
                      {t("vulnerabilities.fixedIn", {
                        versions: a.fixedVersions.join(", "),
                      })}
                    </small>
                  )}
                </ListItem>
              ))}
            </List>
          </DescriptionListDescription>
        </DescriptionListGroup>
      )}

      <DescriptionListGroup>
        <DescriptionListTerm>
          {t("vulnerabilities.package")}
        </DescriptionListTerm>
        <DescriptionListDescription>
          <code>{f.package.purl}</code>
          {f.package.ecosystem && (
            <Label isCompact variant="outline" className={spacing.mlSm}>
              {t(`vulnerabilities.ecosystem.${f.package.ecosystem}`)}
            </Label>
          )}
          {f.fixedModule && (
            <div>
              {t("vulnerabilities.moduleMigration", {
                module: f.fixedModule,
                version: f.fixedVersion,
              })}
            </div>
          )}
          <div>
            {f.package.direct
              ? t("vulnerabilities.directDependency")
              : t("vulnerabilities.transitiveDependency")}
            {f.redHatFix &&
              ` · ${t("vulnerabilities.redHatFix", { version: f.redHatFix })}`}
          </div>
        </DescriptionListDescription>
      </DescriptionListGroup>

      {f.reachability && (
        <DescriptionListGroup>
          <DescriptionListTerm>
            {t("vulnerabilities.reachabilityRgctl")}
          </DescriptionListTerm>
          <DescriptionListDescription>
            <CveReachabilityDetails reachability={f.reachability} />
          </DescriptionListDescription>
        </DescriptionListGroup>
      )}

      <DescriptionListGroup>
        <DescriptionListTerm>
          {t("vulnerabilities.remediation")}
        </DescriptionListTerm>
        <DescriptionListDescription>
          {f.strategyReason && <div>{f.strategyReason}</div>}
          {f.message && (
            <div>
              <small>{f.message}</small>
            </div>
          )}
          <Flex className={spacing.mtSm} gap={{ default: "gapMd" }}>
            {f.pullRequestUrl ? (
              <FlexItem>
                <ExternalLink href={f.pullRequestUrl}>
                  {t("vulnerabilities.pullRequest", {
                    number: f.pullRequestNumber,
                  })}
                </ExternalLink>
              </FlexItem>
            ) : (
              f.compareUrl && (
                <FlexItem>
                  <ExternalLink href={f.compareUrl}>
                    {t("vulnerabilities.viewChanges", { branch: f.branch })}
                  </ExternalLink>
                </FlexItem>
              )
            )}
            {f.agentRun && (
              <FlexItem>
                <Link
                  to={formatPath(DevPaths.agentRunDetails, {
                    runName: f.agentRun,
                  })}
                >
                  {t("vulnerabilities.agentRun", {
                    name: f.agentRun,
                    phase: f.agentRunPhase ?? "",
                  })}
                </Link>
              </FlexItem>
            )}
            {f.taskId != null && (
              <FlexItem>
                <Link
                  to={formatPath(Paths.applicationsTaskDetails, {
                    applicationId: applicationId,
                    taskId: f.taskId,
                  })}
                >
                  {t("vulnerabilities.task", { id: f.taskId })}
                </Link>
              </FlexItem>
            )}
          </Flex>
          {f.buildLog && (
            <ExpandableSection toggleText={t("vulnerabilities.buildErrors")}>
              <CodeBlock>
                <CodeBlockCode>{f.buildLog}</CodeBlockCode>
              </CodeBlock>
            </ExpandableSection>
          )}
        </DescriptionListDescription>
      </DescriptionListGroup>
    </DescriptionList>
  );
};
