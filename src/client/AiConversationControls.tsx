import { Send, SlidersHorizontal } from "lucide-react";
import React, { useState } from "react";
import type {
  AiClarificationAnswer,
  AiClarifyingQuestion,
  AiConversationMessage,
  AiQuickAdjustment
} from "../shared/aiContracts";
import { quickAdjustmentLabel } from "./aiConversation";

type AiConversationControlsProps = {
  messages: AiConversationMessage[];
  commands?: Array<{ id: string; label: string }>;
  quickAdjustments: AiQuickAdjustment[];
  clarifyingQuestion?: AiClarifyingQuestion;
  busy: boolean;
  intro?: {
    title: string;
    body: string;
  };
  inputPlaceholder?: string;
  children?: React.ReactNode;
  onCommand?: (commandId: string) => void;
  onSendMessage: (message: string) => void;
  onQuickAdjust: (adjustment: AiQuickAdjustment) => void;
  onAnswerClarification: (answer: AiClarificationAnswer) => void;
  onSkipClarification: () => void;
};

export function shouldSendAiMessageFromKey(key: string, isComposing: boolean) {
  return key === "Enter" && !isComposing;
}

export function AiConversationControls({
  messages,
  commands = [],
  quickAdjustments,
  clarifyingQuestion,
  busy,
  intro,
  inputPlaceholder = "继续告诉 AI 你想怎么调整",
  children,
  onCommand,
  onSendMessage,
  onQuickAdjust,
  onAnswerClarification,
  onSkipClarification
}: AiConversationControlsProps) {
  const [message, setMessage] = useState("");
  const trimmedMessage = message.trim();

  const send = () => {
    if (!trimmedMessage || busy) return;
    onSendMessage(trimmedMessage);
    setMessage("");
  };

  return (
    <div className="ai-conversation">
      {((messages.length > 0 || children) || intro) && (
        <div className="ai-message-list" aria-live="polite">
          {messages.length === 0 && intro && (
            <div className="ai-message assistant">
              <strong>{intro.title}</strong>
              <span>{intro.body}</span>
            </div>
          )}
          {messages.map((item, index) => (
            <div key={`${item.role}-${index}-${item.content}`} className={`ai-message ${item.role}`}>
              <strong>{item.role === "user" ? "你" : "AI"}</strong>
              <span>{item.content}</span>
            </div>
          ))}
          {children && (
            <div className="ai-message assistant ai-result-message">
              <strong>AI</strong>
              <div className="ai-result-card">{children}</div>
            </div>
          )}
        </div>
      )}

      {clarifyingQuestion && (
        <div className="ai-clarifying-question">
          <strong>{clarifyingQuestion.question}</strong>
          <div className="ai-quick-actions">
            {clarifyingQuestion.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() =>
                  onAnswerClarification({
                    questionId: clarifyingQuestion.id,
                    optionId: option.id,
                    label: option.label
                  })
                }
              >
                {option.label}
              </button>
            ))}
            <button type="button" className="ghost-button" disabled={busy} onClick={onSkipClarification}>
              按现有信息生成
            </button>
          </div>
        </div>
      )}

      {commands.length > 0 && (
        <div className="ai-command-actions">
          {commands.map((command) => (
            <button
              key={command.id}
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => onCommand?.(command.id)}
            >
              {command.label}
            </button>
          ))}
        </div>
      )}

      {quickAdjustments.length > 0 && (
        <div className="ai-quick-actions">
          {quickAdjustments.map((adjustment) => (
            <button
              key={adjustment}
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => onQuickAdjust(adjustment)}
            >
              <SlidersHorizontal />
              {quickAdjustmentLabel(adjustment)}
            </button>
          ))}
        </div>
      )}

      <div className="ai-input-row">
        <input
          type="text"
          value={message}
          disabled={busy}
          placeholder={inputPlaceholder}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (shouldSendAiMessageFromKey(event.key, event.nativeEvent.isComposing)) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="primary-button" disabled={busy || !trimmedMessage} onClick={send}>
          <Send />
          发送
        </button>
      </div>
    </div>
  );
}
