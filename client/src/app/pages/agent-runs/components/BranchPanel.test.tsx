import { render, screen, waitFor } from "@testing-library/react";

import { BranchPanel } from "./BranchPanel";

const fetchMock = jest.fn();

describe("BranchPanel not-pushed copy", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const notPushed = () =>
    fetchMock.mockResolvedValue({ ok: false, status: 404 });

  it("live run without branch says waiting", async () => {
    notPushed();
    render(
      <BranchPanel
        repoUrl="https://github.com/acme/app"
        targetBranch="migration/demo"
        isTerminal={false}
      />
    );
    await waitFor(() =>
      expect(
        screen.getByText("agentic.runDetail.feedNotPushedLive")
      ).toBeInTheDocument()
    );
  });

  it("finished run without branch says nothing pushed", async () => {
    notPushed();
    render(
      <BranchPanel
        repoUrl="https://github.com/acme/app"
        targetBranch="migration/demo"
        isTerminal={true}
      />
    );
    await waitFor(() =>
      expect(
        screen.getByText("agentic.runDetail.feedNotPushedTerminal")
      ).toBeInTheDocument()
    );
  });
});

describe("BranchPanel commit feed", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  const pushed = (messages: string[]) =>
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        messages.map((message, i) => ({
          sha: `sha-${i}`,
          html_url: `https://github.com/acme/app/commit/sha-${i}`,
          commit: { message, author: { date: new Date().toISOString() } },
        })),
    });

  it("shows only the head commit, not the history", async () => {
    pushed(["konveyor: stage output", "older commit"]);
    render(
      <BranchPanel
        repoUrl="https://github.com/acme/app"
        targetBranch="migration/demo"
        isTerminal={true}
      />
    );
    await waitFor(() =>
      expect(screen.getByText("konveyor: stage output")).toBeInTheDocument()
    );
    expect(screen.queryByText("older commit")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("per_page=1")
    );
  });
});
