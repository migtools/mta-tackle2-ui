import "@testing-library/jest-dom";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryHistory } from "history";
import { Router } from "react-router-dom";

import type {
  AgentRun,
  AgentWorkflowRun,
  AgentWorkflowRunPhase,
  AgentWorkflowRunStageStatus,
  ExecutionSpec,
} from "@app/api/agentic/contract";

import WorkflowRunDetailPage from "./workflow-run-detail-page";

const mockUseFetchWorkflowRun = jest.fn();
const mockUseFetchAgentRunsByNames = jest.fn();
const mockRunPanel = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useParams: () => ({ runName: "workflow-run" }),
}));

jest.mock("@app/queries/workflow-runs", () => ({
  useFetchWorkflowRun: (...args: unknown[]) => mockUseFetchWorkflowRun(...args),
}));

jest.mock("@app/queries/agent-runs", () => ({
  useFetchAgentRunsByNames: (...args: unknown[]) =>
    mockUseFetchAgentRunsByNames(...args),
}));

jest.mock("@app/queries/applications", () => ({
  useFetchApplications: () => ({ data: [], error: null }),
}));

jest.mock("@app/auth", () => ({
  useHasSomeScopes: () => true,
}));

jest.mock("@app/pages/agent-runs/components/run-panel", () => ({
  RunPanel: (props: unknown) => {
    mockRunPanel(props);
    return createElement("div", { "data-testid": "run-panel" });
  },
}));

const stagesWith = (
  ...stages: Partial<AgentWorkflowRunStageStatus>[]
): AgentWorkflowRunStageStatus[] =>
  stages.map((s, i) => ({
    name: s.name ?? `stage-${i}`,
    phase: s.phase,
    agentRunName: s.agentRunName,
    agentRef: s.agentRef,
    instructions: s.instructions,
    execution: s.execution,
  }));

const workflowRun = (
  phase: AgentWorkflowRunPhase,
  stages: AgentWorkflowRunStageStatus[],
  extraStatus: Partial<AgentWorkflowRun["status"]> = {}
): AgentWorkflowRun => ({
  metadata: {
    name: "workflow-run",
    creationTimestamp: "2026-09-08T12:00:00Z",
  },
  spec: {
    workflowRef: "workflow",
    env: [{ name: "TARGET_BRANCH", value: "migration/demo" }],
  },
  status: {
    phase,
    currentStage: "plan",
    stages,
    ...extraStatus,
  },
});

const childRun = (name: string, agentRef: string): AgentRun => ({
  metadata: { name },
  spec: { agentRef },
  status: {
    phase: "Running",
    conditions: [{ type: "ACPReady", status: "True" }],
  },
});

const history = createMemoryHistory();
const renderPage = () =>
  render(
    <Router history={history}>
      <WorkflowRunDetailPage />
    </Router>
  );

describe("workflow run stage cards", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFetchAgentRunsByNames.mockReturnValue({
      runs: {},
      isLoading: false,
    });
  });

  it("renders a card per stage with agent and status", () => {
    mockUseFetchWorkflowRun.mockReturnValue({
      workflowRun: workflowRun(
        "Running",
        stagesWith(
          {
            name: "plan",
            phase: "Succeeded",
            agentRunName: "ui-plan",
            agentRef: "planner",
          },
          {
            name: "execute",
            phase: "Running",
            agentRunName: "ui-exec",
            agentRef: "kai",
          },
          { name: "verify", agentRef: "kai" }
        )
      ),
      isLoading: false,
      fetchError: null,
    });
    mockUseFetchAgentRunsByNames.mockReturnValue({
      runs: {
        "ui-plan": childRun("ui-plan", "planner"),
        "ui-exec": childRun("ui-exec", "kai"),
      },
      isLoading: false,
    });

    renderPage();

    expect(
      screen.getByText("plan", { selector: ".stage-card-name" })
    ).toBeInTheDocument();
    expect(screen.getByText("execute")).toBeInTheDocument();
    expect(screen.getByText("verify")).toBeInTheDocument();
    expect(screen.getAllByText("planner").length).toBeGreaterThan(0);
    expect(screen.getAllByText("kai").length).toBeGreaterThan(0);
    // The unstarted stage says so instead of naming an agent run.
    expect(
      screen.getByText("agentic.workflowRuns.notStarted")
    ).toBeInTheDocument();
  });

  it("defaults selection to the failed stage", () => {
    mockUseFetchWorkflowRun.mockReturnValue({
      workflowRun: workflowRun(
        "Failed",
        stagesWith(
          { name: "plan", phase: "Succeeded", agentRunName: "ui-plan" },
          { name: "execute", phase: "Failed", agentRunName: "ui-exec" },
          { name: "verify", phase: "Succeeded", agentRunName: "ui-verify" }
        )
      ),
      isLoading: false,
      fetchError: null,
    });
    mockUseFetchAgentRunsByNames.mockReturnValue({
      runs: {
        "ui-plan": childRun("ui-plan", "planner"),
        "ui-exec": {
          ...childRun("ui-exec", "kai"),
          status: { phase: "Failed" },
        },
        "ui-verify": childRun("ui-verify", "kai"),
      },
      isLoading: false,
    });

    renderPage();

    expect(mockRunPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({
          metadata: expect.objectContaining({ name: "ui-exec" }),
        }),
        stageInstructions: undefined,
      })
    );
  });

  it("selecting a card updates ?stage", async () => {
    mockUseFetchWorkflowRun.mockReturnValue({
      workflowRun: workflowRun(
        "Running",
        stagesWith(
          { name: "plan", phase: "Succeeded", agentRunName: "ui-plan" },
          { name: "execute", phase: "Running", agentRunName: "ui-exec" }
        )
      ),
      isLoading: false,
      fetchError: null,
    });
    mockUseFetchAgentRunsByNames.mockReturnValue({
      runs: {
        "ui-plan": childRun("ui-plan", "planner"),
        "ui-exec": childRun("ui-exec", "kai"),
      },
      isLoading: false,
    });

    renderPage();

    await userEvent.click(
      screen.getByText("plan", { selector: ".stage-card-name" })
    );
    expect(history.location.search).toBe("?stage=plan");
  });

  it("unstarted stage shows instructions", async () => {
    mockUseFetchWorkflowRun.mockReturnValue({
      workflowRun: workflowRun(
        "Running",
        stagesWith(
          { name: "plan", phase: "Succeeded", agentRunName: "ui-plan" },
          {
            name: "verify",
            instructions: "verify the branch builds",
            agentRef: "kai",
          }
        ),
        { currentStage: "plan" }
      ),
      isLoading: false,
      fetchError: null,
    });
    mockUseFetchAgentRunsByNames.mockReturnValue({
      runs: { "ui-plan": childRun("ui-plan", "planner") },
      isLoading: false,
    });

    renderPage();

    // Select the unstarted stage by clicking its card.
    await userEvent.click(screen.getByText("verify"));
    expect(history.location.search).toBe("?stage=verify");
    expect(screen.getByText("verify the branch builds")).toBeInTheDocument();
    expect(
      screen.getByText("agentic.workflowRuns.stageNotStarted")
    ).toBeInTheDocument();
  });

  it("failure header has no raw JSON", () => {
    mockUseFetchWorkflowRun.mockReturnValue({
      workflowRun: workflowRun(
        "Failed",
        stagesWith({
          name: "execute",
          phase: "Failed",
          agentRunName: "ui-exec",
        }),
        {
          conditions: [
            {
              type: "Succeeded",
              status: "False",
              reason: "StageFailed",
              message:
                'Stage "execute" did not succeed: {"exitCode":1,"outcome":"failed","stopReason":"final push: push konveyor/migration-1793928293: malformed unpack status: \\u0001001dunpack index-pack failed","usage":{"turnsUsed":67,"contextUsed":114330,"contextSize":128000}}',
            },
          ],
        }
      ),
      isLoading: false,
      fetchError: null,
    });
    mockUseFetchAgentRunsByNames.mockReturnValue({
      runs: {
        "ui-exec": {
          ...childRun("ui-exec", "kai"),
          status: { phase: "Failed" },
        },
      },
      isLoading: false,
    });

    renderPage();

    const header = screen.getByText(/final push:/);
    expect(header).toBeInTheDocument();
    expect(header.textContent).not.toContain("exitCode");
  });
});

describe("workflow live-stage viewer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseFetchAgentRunsByNames.mockReturnValue({
      runs: {},
      isLoading: false,
    });
  });

  it("automatically mounts the selected child AgentRun viewer", () => {
    mockUseFetchWorkflowRun.mockReturnValue({
      workflowRun: workflowRun(
        "Running",
        stagesWith({
          name: "plan",
          phase: "Running",
          agentRunName: "ui-plan",
          execution: undefined,
        })
      ),
      isLoading: false,
      fetchError: null,
    });
    const run = childRun("ui-plan", "planner");
    mockUseFetchAgentRunsByNames.mockReturnValue({
      runs: { "ui-plan": run },
      isLoading: false,
    });

    renderPage();

    expect(mockUseFetchAgentRunsByNames).toHaveBeenCalledWith(["ui-plan"]);
    // Auto mode (no `execution`): a neutral note, never the approval warning.
    expect(
      screen.queryByText("agentic.workflowRuns.approvalViewerTitle")
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("agentic.workflowRuns.autoModeViewerNote")
    ).toBeInTheDocument();
    expect(mockRunPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        run,
        targetBranch: "migration/demo",
      })
    );
  });

  it("warns about approvals when the live AgentRun is in approve mode", () => {
    mockUseFetchWorkflowRun.mockReturnValue({
      workflowRun: workflowRun(
        "Running",
        stagesWith({
          name: "plan",
          phase: "Running",
          agentRunName: "ui-plan",
        })
      ),
      isLoading: false,
      fetchError: null,
    });
    mockUseFetchAgentRunsByNames.mockReturnValue({
      runs: {
        "ui-plan": {
          ...childRun("ui-plan", "planner"),
          spec: { agentRef: "planner", execution: { mode: "approve" } },
        },
      },
      isLoading: false,
    });

    renderPage();

    expect(
      screen.getByText("agentic.workflowRuns.approvalViewerTitle")
    ).toBeInTheDocument();
    expect(
      screen.queryByText("agentic.workflowRuns.autoModeViewerNote")
    ).not.toBeInTheDocument();
  });

  it("warns from the stage's own execution before the AgentRun loads", () => {
    mockUseFetchWorkflowRun.mockReturnValue({
      workflowRun: workflowRun(
        "Running",
        stagesWith({
          name: "plan",
          phase: "Running",
          agentRunName: "ui-plan",
          execution: { mode: "approve" } as ExecutionSpec,
        })
      ),
      isLoading: false,
      fetchError: null,
    });
    mockUseFetchAgentRunsByNames.mockReturnValue({
      runs: {},
      isLoading: true,
    });

    renderPage();

    expect(
      screen.getByText("agentic.workflowRuns.approvalViewerTitle")
    ).toBeInTheDocument();
  });

  it("shows the recorded panel after the workflow finishes", () => {
    mockUseFetchWorkflowRun.mockReturnValue({
      workflowRun: workflowRun(
        "Succeeded",
        stagesWith({
          name: "plan",
          phase: "Succeeded",
          agentRunName: "ui-plan",
        })
      ),
      isLoading: false,
      fetchError: null,
    });
    mockUseFetchAgentRunsByNames.mockReturnValue({
      runs: {
        "ui-plan": {
          ...childRun("ui-plan", "planner"),
          status: { phase: "Succeeded" },
        },
      },
      isLoading: false,
    });

    renderPage();

    // The finished workflow keeps its stage's recorded run visible.
    expect(mockRunPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        run: expect.objectContaining({
          status: expect.objectContaining({ phase: "Succeeded" }),
        }),
      })
    );
    // No live-mode notice on a finished workflow.
    expect(
      screen.queryByText("agentic.workflowRuns.approvalViewerTitle")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("agentic.workflowRuns.autoModeViewerNote")
    ).not.toBeInTheDocument();
  });
});
