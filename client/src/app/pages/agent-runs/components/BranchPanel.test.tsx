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
