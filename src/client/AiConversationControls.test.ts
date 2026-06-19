import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AI_THINKING_STATUS_LABEL, AiConversationControls, shouldSendAiMessageFromKey } from "./AiConversationControls";

describe("AiConversationControls keyboard handling", () => {
  it("does not send Enter while an IME composition is active", () => {
    expect(shouldSendAiMessageFromKey("Enter", true)).toBe(false);
  });

  it("sends plain Enter when no IME composition is active", () => {
    expect(shouldSendAiMessageFromKey("Enter", false)).toBe(true);
    expect(shouldSendAiMessageFromKey("Escape", false)).toBe(false);
  });
});

describe("AiConversationControls pending state", () => {
  it("renders an accessible AI thinking status while a request is pending", () => {
    const html = renderToStaticMarkup(
      React.createElement(AiConversationControls, {
        messages: [{ role: "user", content: "帮我优化这个目标" }],
        quickAdjustments: [],
        busy: true,
        pending: true,
        onSendMessage: () => undefined,
        onQuickAdjust: () => undefined,
        onAnswerClarification: () => undefined,
        onSkipClarification: () => undefined
      })
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(AI_THINKING_STATUS_LABEL);
    expect(html).toContain("思考中");
  });
});
