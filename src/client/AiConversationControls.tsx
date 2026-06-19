import { Activity, CalendarCheck, ListTree, Loader2, Send, SlidersHorizontal, Sparkles } from "lucide-react";
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
  pending?: boolean;
  pendingLabel?: string;
  showSkipClarification?: boolean;
  clarificationSkipLabel?: string;
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

export const AI_THINKING_STATUS_LABEL = "AI 正在校准星图...";

export function shouldSendAiMessageFromKey(key: string, isComposing: boolean) {
  return key === "Enter" && !isComposing;
}

export function AiConversationControls({
  messages,
  commands = [],
  quickAdjustments,
  clarifyingQuestion,
  busy,
  pending = false,
  pendingLabel = AI_THINKING_STATUS_LABEL,
  showSkipClarification = true,
  clarificationSkipLabel = "按现有信息生成",
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
      {((messages.length > 0 || children || pending) || intro) && (
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
          {pending && (
            <div className="ai-message assistant ai-thinking-message" role="status" aria-live="polite" aria-label={pendingLabel}>
              <strong>AI</strong>
              <span className="ai-thinking-content">
                <span className="ai-thinking-orbit" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>{pendingLabel}</span>
              </span>
            </div>
          )}
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
            {showSkipClarification && (
              <button type="button" className="ghost-button" disabled={busy} onClick={onSkipClarification}>
                {clarificationSkipLabel}
              </button>
            )}
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
              <CommandIcon id={command.id} />
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
          placeholder={pending ? "AI 正在思考，请稍候" : inputPlaceholder}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (shouldSendAiMessageFromKey(event.key, event.nativeEvent.isComposing)) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="primary-button" disabled={busy || !trimmedMessage} onClick={send}>
          {pending ? <Loader2 className="spin" /> : <Send />}
          {pending ? "思考中" : "发送"}
        </button>
      </div>
    </div>
  );
}

function CommandIcon({ id }: { id: string }) {
  if (id === "subgoals") return <ListTree aria-hidden="true" focusable="false" />;
  if (id === "diagnose") return <Activity aria-hidden="true" focusable="false" />;
  if (id === "weekly") return <CalendarCheck aria-hidden="true" focusable="false" />;
  return <Sparkles aria-hidden="true" focusable="false" />;
}
