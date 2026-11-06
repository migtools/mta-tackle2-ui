import type { SessionUpdate } from "@app/api/agentic/acp";

import { reduceUpdate } from "./transcript-model";
import type { ChatItem } from "./transcript-model";

const chunk = (text: string): SessionUpdate => ({
  sessionUpdate: "agent_message_chunk",
  content: { type: "text", text },
});

describe("transcript model (moved from ChatPanel)", () => {
  it("folds streamed chunks into one agent item", () => {
    let id = 0;
    const nextId = () => ++id;
    let items: ChatItem[] = [];
    items = reduceUpdate(items, chunk("Hello "), nextId);
    items = reduceUpdate(items, chunk("world"), nextId);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: "agent", text: "Hello world" });
  });

  it("keeps tool calls and updates them by toolCallId", () => {
    let id = 0;
    const nextId = () => ++id;
    let items: ChatItem[] = [];
    items = reduceUpdate(
      items,
      {
        sessionUpdate: "tool_call",
        toolCallId: "t1",
        title: "read_file",
        status: "pending",
      },
      nextId
    );
    items = reduceUpdate(
      items,
      {
        sessionUpdate: "tool_call_update",
        toolCallId: "t1",
        status: "completed",
      },
      nextId
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      kind: "tool",
      toolCallId: "t1",
      status: "completed",
    });
  });
});
