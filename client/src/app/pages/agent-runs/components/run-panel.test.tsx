import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AgentRun } from "@app/api/agentic/contract";
import { streamAgentRunTranscript } from "@app/api/rest/agent-run-streams";

import { RunPanel } from "./run-panel";

jest.mock("@app/api/rest/agent-run-streams", () => ({
  ...jest.requireActual("@app/api/rest/agent-run-streams"),
  streamAgentRunTranscript: jest.fn(),
}));

jest.mock("./ChatPanel", () => ({
  ...jest.requireActual("./ChatPanel"),
  ChatPanel: () => <div data-testid="chat-panel" />,
}));

jest.mock("./run-logs-tab", () => ({
  RunLogsTab: () => <div data-testid="logs-tab" />,
}));

// @patternfly/chatbot ships an ESM react-markdown dependency that jest
// cannot run untransformed; stub the pieces the panel tree uses.
jest.mock("@patternfly/chatbot", () => ({
  Chatbot: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ChatbotAlert: ({ title }: { title?: string }) => <div>{title}</div>,
  ChatbotContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  ChatbotDisplayMode: { fullscreen: "fullscreen", embedded: "embedded" },
  ChatbotFooter: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  ChatbotFootnote: () => null,
  ChatbotHeader: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  ChatbotHeaderActions: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  ChatbotHeaderMain: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  ChatbotHeaderTitle: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  Message: ({ name, content }: { name?: string; content?: string }) => (
    <div>
      <span>{name}</span>
      <span>{content}</span>
    </div>
  ),
  MessageBar: () => null,
  MessageBox: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  MessageDivider: ({ content }: { content?: string }) => <div>{content}</div>,
}));

const mockTranscript = streamAgentRunTranscript as jest.Mock;

const baseRun = (overrides: Partial<AgentRun> = {}): AgentRun =>
  ({
    metadata: { name: "run-a" },
    spec: {
      agentRef: "kai",
      instructions: "fix the cve",
    },
    status: {
      phase: "Running",
      startTime: "2026-11-05T10:00:00Z",
      conditions: [
        {
          type: "ACPReady",
          status: "True",
          reason: "Listening",
          message: "endpoint accepts",
        },
      ],
    },
    ...overrides,
  }) as AgentRun;

const startTranscript = (
  lines: unknown[],
  status: Record<string, unknown> = {}
) =>
  mockTranscript.mockImplementation(
    async (
      _name: string,
      opts: { onLine: (l: unknown) => void; onStatus?: (s: unknown) => void }
    ) => {
      opts.onStatus?.(status);
      for (const line of lines) opts.onLine(line);
    }
  );

describe("RunPanel", () => {
  beforeEach(() => {
    mockTranscript.mockReset();
  });

  it("auto-mode run uses recorded transcript", async () => {
    startTranscript([
      {
        t: "2026-11-05T10:00:01Z",
        frame: {
          method: "session/update",
          params: {
            sessionId: "s1",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "hello from the recording" },
            },
          },
        },
      },
    ]);
    render(<RunPanel run={baseRun()} />);
    await waitFor(() =>
      expect(screen.getByText("hello from the recording")).toBeInTheDocument()
    );
    // The transcript tab is the default for a live auto-mode run.
    expect(mockTranscript).toHaveBeenCalledWith(
      "run-a",
      expect.objectContaining({ follow: true })
    );
  });

  it("approve-mode live run uses ChatPanel", () => {
    const run = baseRun();
    run.spec.execution = { mode: "approve" };
    render(<RunPanel run={run} />);
    expect(screen.getByTestId("chat-panel")).toBeInTheDocument();
    expect(mockTranscript).not.toHaveBeenCalled();
  });

  it("finished run with no recording defaults to logs tab", async () => {
    startTranscript([], { transcript: "none" });
    const run = baseRun({
      status: {
        phase: "Failed",
        startTime: "2026-11-05T10:00:00Z",
        conditions: [],
      },
    });
    render(<RunPanel run={run} />);
    await waitFor(() =>
      expect(screen.getByTestId("logs-tab")).toBeInTheDocument()
    );
    // The no-recording sentence is reachable from the transcript tab.
    expect(screen.getByText("agentic.transcript.none")).toBeInTheDocument();
  });

  it("details tab lists conditions", async () => {
    startTranscript([]);
    render(<RunPanel run={baseRun()} />);
    await userEvent.click(
      screen.getByRole("tab", { name: "agentic.runPanel.details" })
    );
    expect(screen.getByText("ACPReady")).toBeInTheDocument();
    expect(screen.getByText("Listening")).toBeInTheDocument();
    expect(screen.getByText("endpoint accepts")).toBeInTheDocument();
  });
});
