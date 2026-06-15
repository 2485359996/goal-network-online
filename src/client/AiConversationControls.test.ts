import { describe, expect, it } from "vitest";
import { shouldSendAiMessageFromKey } from "./AiConversationControls";

describe("AiConversationControls keyboard handling", () => {
  it("does not send Enter while an IME composition is active", () => {
    expect(shouldSendAiMessageFromKey("Enter", true)).toBe(false);
  });

  it("sends plain Enter when no IME composition is active", () => {
    expect(shouldSendAiMessageFromKey("Enter", false)).toBe(true);
    expect(shouldSendAiMessageFromKey("Escape", false)).toBe(false);
  });
});
