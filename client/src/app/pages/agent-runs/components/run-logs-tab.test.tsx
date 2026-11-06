import { act } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { streamAgentRunLogs } from "@app/api/rest/agent-run-streams";

import { ansiToSpans } from "./ansi";
import { RunLogsTab } from "./run-logs-tab";

jest.mock("@app/api/rest/agent-run-streams", () => ({
  streamAgentRunLogs: jest.fn(),
}));

const mockStream = streamAgentRunLogs as jest.Mock;

describe("ansiToSpans", () => {
  it("renders plain text as one span", () => {
    expect(ansiToSpans("hello")).toEqual([{ text: "hello" }]);
  });

  it("colors a wrapped word", () => {
    const spans = ansiToSpans("\u001b[33mWARN\u001b[0m x");
    expect(spans).toEqual([
      { text: "WARN", className: "ansi-yellow" },
      { text: " x" },
    ]);
  });

  it("bolds and colors together", () => {
    const spans = ansiToSpans("\u001b[1;31mERR\u001b[0m");
    expect(spans[0]).toEqual({
      text: "ERR",
      className: "ansi-bold ansi-red",
    });
  });
});

describe("RunLogsTab", () => {
  beforeEach(() => {
    mockStream.mockReset();
  });

  const startStream = () =>
    mockStream.mockImplementation(
      async (
        _name: string,
        opts: {
          onChunk: (t: string) => void;
          onStatus?: (s: unknown) => void;
        }
      ) => {
        // Real fetch defers chunks by at least a microtask; a synchronous
        // mock would fire before StrictMode's cleanup aborts the stream.
        await Promise.resolve();
        opts.onStatus?.({ source: "live" });
        opts.onChunk("\u001b[33mWARN\u001b[0m something\nplain line\n");
      }
    );

  it("renders streamed lines with ansi colors", async () => {
    startStream();
    render(<RunLogsTab runName="run-a" isLive={true} />);
    await waitFor(() =>
      expect(screen.getByText("WARN")).toHaveClass("ansi-yellow")
    );
    expect(screen.getByText("plain line")).toBeInTheDocument();
  });

  it("caps rendered lines", async () => {
    mockStream.mockImplementation(
      async (_name: string, opts: { onChunk: (t: string) => void }) => {
        await Promise.resolve();
        const batch: string[] = [];
        for (let i = 0; i < 6000; i++) batch.push(`line-${i}`);
        opts.onChunk(batch.join("\n") + "\n");
      }
    );
    render(<RunLogsTab runName="run-a" isLive={true} />);
    // The i18n mock returns bare keys, so assert on the key plus the
    // rendering effect of the cap (oldest lines dropped, newest kept).
    await waitFor(() =>
      expect(screen.getByText("agentic.logs.truncated")).toBeInTheDocument()
    );
    expect(screen.queryByText("line-0")).not.toBeInTheDocument();
    expect(screen.getByText("line-5999")).toBeInTheDocument();
  });

  it("pauses follow on scroll up", async () => {
    startStream();
    render(<RunLogsTab runName="run-a" isLive={true} />);
    await waitFor(() =>
      expect(screen.getByText("plain line")).toBeInTheDocument()
    );
    const scroller = screen.getByRole("log");
    // Simulate scrolling away from the bottom.
    Object.defineProperty(scroller, "scrollHeight", {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(scroller, "scrollTop", {
      value: 100,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scroller, "clientHeight", {
      value: 200,
      configurable: true,
    });
    await act(async () => {
      scroller.dispatchEvent(new Event("scroll"));
    });
    expect(
      await screen.findByRole("button", { name: "agentic.logs.resumeFollow" })
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "agentic.logs.resumeFollow" })
    );
    expect(
      screen.queryByRole("button", { name: "agentic.logs.resumeFollow" })
    ).not.toBeInTheDocument();
  });
});
