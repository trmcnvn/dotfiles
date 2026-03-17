import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
} from "@mariozechner/pi-tui";
import { Type, type Static } from "@sinclair/typebox";

type JsonRecord = Record<string, unknown>;

type QuestionOption = {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
};

type RenderOption = QuestionOption & {
  readonly isOther?: true;
};

type Question = {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
  readonly options: readonly QuestionOption[];
  readonly allowOther: boolean;
};

type Answer = {
  readonly id: string;
  readonly value: string;
  readonly label: string;
  readonly wasCustom: boolean;
  readonly index?: number;
};

type QuestionnaireResult = {
  readonly questions: readonly Question[];
  readonly answers: readonly Answer[];
  readonly cancelled: boolean;
};

type QuestionnaireToolResult = {
  content: { type: "text"; text: string }[];
  details: QuestionnaireResult;
};

const OTHER_OPTION_VALUE = "__other__";
const CANCELLED_TEXT = "User cancelled the questionnaire.";
const NON_INTERACTIVE_TEXT =
  "Questionnaire requires interactive UI mode. Re-run in interactive mode to ask the user.";
const PRESTART_CANCELLED_TEXT = "Questionnaire was cancelled before it started.";
const EMPTY_CUSTOM_ANSWER = "(no response)";

const QuestionOptionSchema = Type.Object({
  value: Type.String({ description: "The value returned when selected" }),
  label: Type.String({ description: "Display label for the option" }),
  description: Type.Optional(
    Type.String({ description: "Optional description shown below label" }),
  ),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Unique identifier for this question" }),
  label: Type.Optional(
    Type.String({
      description:
        "Short contextual label for tab navigation (defaults to Q1, Q2, ...)",
    }),
  ),
  prompt: Type.String({ description: "The question text to display" }),
  options: Type.Array(QuestionOptionSchema, {
    minItems: 1,
    description: "Available options to choose from",
  }),
  allowOther: Type.Optional(
    Type.Boolean({
      description: "Allow a custom typed answer option (default: true)",
    }),
  ),
});

const QuestionnaireParamsSchema = Type.Object({
  questions: Type.Array(QuestionSchema, {
    minItems: 1,
    description: "Questions to ask the user",
  }),
});

type QuestionnaireParams = Static<typeof QuestionnaireParamsSchema>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const normalizeQuestionLabel = (label: string | undefined, fallback: string): string => {
  const trimmed = label?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : fallback;
};

const normalizeQuestions = (questions: QuestionnaireParams["questions"]): Question[] => {
  const seenIds = new Set<string>();

  return questions.map((question, index) => {
    const id = question.id.trim();
    if (id.length === 0) {
      throw new Error(
        `Question ${index + 1} has an empty id. Provide a stable non-empty id for each question.`,
      );
    }
    if (seenIds.has(id)) {
      throw new Error(`Question ids must be unique. Duplicate id: "${id}".`);
    }
    seenIds.add(id);

    const prompt = question.prompt.trim();
    if (prompt.length === 0) {
      throw new Error(`Question "${id}" has an empty prompt.`);
    }

    const allowOther = question.allowOther ?? true;
    const seenOptionValues = new Set<string>();

    const options = question.options.map((option, optionIndex) => {
      const optionLabel = option.label.trim();
      if (optionLabel.length === 0) {
        throw new Error(
          `Question "${id}" has an empty option label at position ${optionIndex + 1}.`,
        );
      }

      const optionValue = option.value.trim();
      if (optionValue.length === 0) {
        throw new Error(
          `Question "${id}" has an empty option value at position ${optionIndex + 1}.`,
        );
      }
      if (allowOther && optionValue === OTHER_OPTION_VALUE) {
        throw new Error(
          `Question "${id}" uses reserved option value "${OTHER_OPTION_VALUE}" at position ${optionIndex + 1}. Choose a different option value.`,
        );
      }
      if (seenOptionValues.has(optionValue)) {
        throw new Error(
          `Question "${id}" has duplicate option value "${optionValue}" at position ${optionIndex + 1}. Option values must be unique per question.`,
        );
      }
      seenOptionValues.add(optionValue);

      return {
        value: optionValue,
        label: optionLabel,
        description: option.description,
      } satisfies QuestionOption;
    });

    return {
      id,
      label: normalizeQuestionLabel(question.label, `Q${index + 1}`),
      prompt,
      options,
      allowOther,
    } satisfies Question;
  });
};

const getRenderOptions = (question: Question | undefined): RenderOption[] => {
  if (question === undefined) {
    return [];
  }

  const options: RenderOption[] = question.options.map((option) => ({ ...option }));
  if (question.allowOther) {
    options.push({
      value: OTHER_OPTION_VALUE,
      label: "Type something.",
      isOther: true,
    });
  }

  return options;
};

const isQuestionOption = (value: unknown): value is QuestionOption =>
  isRecord(value) &&
  typeof value.value === "string" &&
  typeof value.label === "string" &&
  (value.description === undefined || typeof value.description === "string");

const isQuestion = (value: unknown): value is Question =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.label === "string" &&
  typeof value.prompt === "string" &&
  Array.isArray(value.options) &&
  value.options.every(isQuestionOption) &&
  typeof value.allowOther === "boolean";

const isAnswer = (value: unknown): value is Answer =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.value === "string" &&
  typeof value.label === "string" &&
  typeof value.wasCustom === "boolean" &&
  (value.index === undefined || typeof value.index === "number");

const parseQuestionnaireResult = (value: unknown): QuestionnaireResult | null => {
  if (!isRecord(value)) {
    return null;
  }

  if (!Array.isArray(value.questions) || !Array.isArray(value.answers)) {
    return null;
  }

  if (!value.questions.every(isQuestion) || !value.answers.every(isAnswer)) {
    return null;
  }

  if (typeof value.cancelled !== "boolean") {
    return null;
  }

  return {
    questions: value.questions,
    answers: value.answers,
    cancelled: value.cancelled,
  };
};

const buildToolResult = (
  text: string,
  details: QuestionnaireResult,
): QuestionnaireToolResult => ({
  content: [{ type: "text", text }],
  details,
});

const snapshotQuestionsFromParams = (
  questions: QuestionnaireParams["questions"],
): Question[] =>
  questions.map((question, index) => ({
    id: question.id.trim().length > 0 ? question.id.trim() : `q${index + 1}`,
    label: normalizeQuestionLabel(question.label, `Q${index + 1}`),
    prompt: question.prompt,
    options: question.options.map((option) => ({
      value: option.value,
      label: option.label,
      description: option.description,
    })),
    allowOther: question.allowOther ?? true,
  }));

const buildCancelledResult = (
  text: string,
  questions: readonly Question[] = [],
): QuestionnaireToolResult =>
  buildToolResult(text, {
    questions,
    answers: [],
    cancelled: true,
  });

const buildQuestionDisplayById = (
  questions: readonly Question[],
): Map<string, string> => {
  const labelCounts = new Map<string, number>();

  for (const question of questions) {
    labelCounts.set(question.label, (labelCounts.get(question.label) ?? 0) + 1);
  }

  const displayById = new Map<string, string>();
  for (const question of questions) {
    const count = labelCounts.get(question.label) ?? 0;
    displayById.set(
      question.id,
      count > 1 ? `${question.label} (${question.id})` : question.label,
    );
  }

  return displayById;
};

const extractQuestionLabelsFromCallArgs = (args: unknown): string[] => {
  if (!isRecord(args) || !Array.isArray(args.questions)) {
    return [];
  }

  return args.questions
    .map((item, index) => {
      if (!isRecord(item)) {
        return `Q${index + 1}`;
      }

      const rawLabel = item.label;
      if (isNonEmptyString(rawLabel)) {
        return rawLabel.trim();
      }

      const rawId = item.id;
      if (isNonEmptyString(rawId)) {
        return rawId.trim();
      }

      return `Q${index + 1}`;
    })
    .filter((label) => label.length > 0);
};

const summarizeAnswersForModel = (
  questions: readonly Question[],
  answers: readonly Answer[],
): string => {
  const answersById = new Map(answers.map((answer) => [answer.id, answer]));
  const questionDisplayById = buildQuestionDisplayById(questions);

  const lines = questions
    .map((question) => {
      const answer = answersById.get(question.id);
      if (answer === undefined) {
        return null;
      }

      const questionDisplay =
        questionDisplayById.get(question.id) ?? question.label;

      if (answer.wasCustom) {
        return `${questionDisplay}: user wrote: ${answer.label}`;
      }

      if (answer.index !== undefined) {
        return `${questionDisplay}: user selected: ${answer.index}. ${answer.label}`;
      }

      return `${questionDisplay}: user selected: ${answer.label}`;
    })
    .filter((line): line is string => line !== null);

  return lines.length > 0 ? lines.join("\n") : "No answers were recorded.";
};

export default function questionnaire(pi: ExtensionAPI) {
  pi.registerTool({
    name: "questionnaire",
    label: "Questionnaire",
    description:
      "Ask the user one or more guided multiple-choice questions with optional custom responses.",
    promptSnippet:
      "Ask the user one or more interactive questionnaire questions and return structured answers.",
    promptGuidelines: [
      "Use this tool when you need explicit user choices to unblock planning or implementation.",
      "Provide clear option labels and short descriptions so users can answer quickly.",
      "Set allowOther to true when the listed options may not be exhaustive.",
    ],
    parameters: QuestionnaireParamsSchema,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const inputQuestionSnapshot = snapshotQuestionsFromParams(params.questions);

      if (!ctx.hasUI) {
        return buildCancelledResult(NON_INTERACTIVE_TEXT, inputQuestionSnapshot);
      }

      if (signal?.aborted) {
        return buildCancelledResult(PRESTART_CANCELLED_TEXT, inputQuestionSnapshot);
      }

      const questions = normalizeQuestions(params.questions);
      const isMultiQuestion = questions.length > 1;
      const submitTabIndex = questions.length;
      const totalTabs = questions.length + 1;

      const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) => {
        let currentTabIndex = 0;
        let optionIndex = 0;
        let inputMode = false;
        let inputQuestionId: string | null = null;
        let cachedLines: string[] | undefined;
        let cachedWidth: number | undefined;
        let focused = false;
        let completed = false;
        let removeAbortListener: (() => void) | undefined;

        const answers = new Map<string, Answer>();

        const editorTheme: EditorTheme = {
          borderColor: (text) => theme.fg("accent", text),
          selectList: {
            selectedPrefix: (text) => theme.fg("accent", text),
            selectedText: (text) => theme.fg("accent", text),
            description: (text) => theme.fg("muted", text),
            scrollInfo: (text) => theme.fg("dim", text),
            noMatch: (text) => theme.fg("warning", text),
          },
        };

        const editor = new Editor(tui, editorTheme);

        const finish = (cancelled: boolean): void => {
          if (completed) {
            return;
          }

          completed = true;
          removeAbortListener?.();
          removeAbortListener = undefined;

          const orderedAnswers = questions
            .map((question) => answers.get(question.id))
            .filter((answer): answer is Answer => answer !== undefined);

          done({
            questions,
            answers: orderedAnswers,
            cancelled,
          });
        };

        const handleAbort = (): void => {
          finish(true);
        };

        if (signal?.aborted) {
          queueMicrotask(() => {
            finish(true);
          });
        } else if (signal !== undefined) {
          signal.addEventListener("abort", handleAbort, { once: true });
          removeAbortListener = () => {
            signal.removeEventListener("abort", handleAbort);
          };
        }

        const refresh = (): void => {
          if (completed) {
            return;
          }

          cachedLines = undefined;
          cachedWidth = undefined;
          tui.requestRender();
        };

        const getCurrentQuestion = (): Question | undefined => questions[currentTabIndex];

        const allAnswered = (): boolean =>
          questions.every((question) => answers.has(question.id));

        const saveAnswer = (
          questionId: string,
          value: string,
          label: string,
          wasCustom: boolean,
          index?: number,
        ): void => {
          answers.set(questionId, {
            id: questionId,
            value,
            label,
            wasCustom,
            index,
          });
        };

        const moveToNextStep = (): void => {
          if (!isMultiQuestion) {
            finish(false);
            return;
          }

          if (currentTabIndex < questions.length - 1) {
            currentTabIndex += 1;
          } else {
            currentTabIndex = submitTabIndex;
          }

          optionIndex = 0;
          refresh();
        };

        editor.onSubmit = (value) => {
          if (completed || inputQuestionId === null) {
            return;
          }

          const trimmed = value.trim();
          const response = trimmed.length > 0 ? trimmed : EMPTY_CUSTOM_ANSWER;

          saveAnswer(inputQuestionId, response, response, true);
          inputMode = false;
          inputQuestionId = null;
          editor.setText("");
          moveToNextStep();
        };

        const handleInput = (data: string): void => {
          if (completed) {
            return;
          }

          if (inputMode) {
            if (matchesKey(data, Key.escape)) {
              inputMode = false;
              inputQuestionId = null;
              editor.setText("");
              refresh();
              return;
            }

            editor.handleInput(data);
            refresh();
            return;
          }

          if (isMultiQuestion) {
            if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
              currentTabIndex = (currentTabIndex + 1) % totalTabs;
              optionIndex = 0;
              refresh();
              return;
            }

            if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
              currentTabIndex =
                (currentTabIndex - 1 + totalTabs) % totalTabs;
              optionIndex = 0;
              refresh();
              return;
            }
          }

          if (currentTabIndex === submitTabIndex) {
            if (matchesKey(data, Key.enter) && allAnswered()) {
              finish(false);
              return;
            }

            if (matchesKey(data, Key.escape)) {
              finish(true);
            }
            return;
          }

          const question = getCurrentQuestion();
          const options = getRenderOptions(question);

          if (matchesKey(data, Key.up)) {
            optionIndex = Math.max(0, optionIndex - 1);
            refresh();
            return;
          }

          if (matchesKey(data, Key.down)) {
            optionIndex = Math.min(options.length - 1, optionIndex + 1);
            refresh();
            return;
          }

          if (matchesKey(data, Key.enter) && question !== undefined) {
            const selectedOption = options[optionIndex];
            if (selectedOption === undefined) {
              return;
            }

            if (selectedOption.isOther) {
              inputMode = true;
              inputQuestionId = question.id;
              editor.setText("");
              refresh();
              return;
            }

            saveAnswer(
              question.id,
              selectedOption.value,
              selectedOption.label,
              false,
              optionIndex + 1,
            );
            moveToNextStep();
            return;
          }

          if (matchesKey(data, Key.escape)) {
            finish(true);
          }
        };

        const render = (width: number): string[] => {
          if (cachedLines !== undefined && cachedWidth === width) {
            return cachedLines;
          }

          cachedWidth = width;
          const renderWidth = Math.max(1, width);
          const border = "─".repeat(renderWidth);
          const lines: string[] = [];

          const question = getCurrentQuestion();
          const options = getRenderOptions(question);

          const addLine = (line: string): void => {
            lines.push(truncateToWidth(line, renderWidth));
          };

          const renderOptions = (): void => {
            for (const [index, option] of options.entries()) {
              const selected = index === optionIndex;
              const prefix = selected ? theme.fg("accent", "> ") : "  ";
              const optionLabel = `${index + 1}. ${option.label}`;

              if (option.isOther && inputMode) {
                addLine(prefix + theme.fg("accent", `${optionLabel} ✎`));
              } else if (selected) {
                addLine(prefix + theme.fg("accent", optionLabel));
              } else {
                addLine(`  ${theme.fg("text", optionLabel)}`);
              }

              if (option.description) {
                addLine(`     ${theme.fg("muted", option.description)}`);
              }
            }
          };

          addLine(theme.fg("accent", border));

          if (isMultiQuestion) {
            const tabs: string[] = ["← "];

            for (const [index, tabQuestion] of questions.entries()) {
              const tabIsActive = index === currentTabIndex;
              const tabIsAnswered = answers.has(tabQuestion.id);
              const completionMark = tabIsAnswered ? "■" : "□";
              const tabText = ` ${completionMark} ${tabQuestion.label} `;
              const tabColor = tabIsAnswered ? "success" : "muted";

              const styledTab = tabIsActive
                ? theme.bg("selectedBg", theme.fg("text", tabText))
                : theme.fg(tabColor, tabText);

              tabs.push(`${styledTab} `);
            }

            const canSubmit = allAnswered();
            const submitTabIsActive = currentTabIndex === submitTabIndex;
            const submitText = " ✓ Submit ";
            const styledSubmit = submitTabIsActive
              ? theme.bg("selectedBg", theme.fg("text", submitText))
              : theme.fg(canSubmit ? "success" : "dim", submitText);

            tabs.push(`${styledSubmit} →`);
            addLine(` ${tabs.join("")}`);
            lines.push("");
          }

          if (inputMode && question !== undefined) {
            addLine(theme.fg("text", ` ${question.prompt}`));
            lines.push("");
            renderOptions();
            lines.push("");
            addLine(theme.fg("muted", " Your answer:"));
            for (const line of editor.render(Math.max(1, renderWidth - 2))) {
              addLine(` ${line}`);
            }
            lines.push("");
            addLine(theme.fg("dim", " Enter to submit • Esc to go back"));
          } else if (currentTabIndex === submitTabIndex) {
            addLine(theme.fg("accent", theme.bold(" Ready to submit")));
            lines.push("");

            for (const submitQuestion of questions) {
              const answer = answers.get(submitQuestion.id);
              if (answer === undefined) {
                continue;
              }

              const prefix = answer.wasCustom ? "(wrote) " : "";
              addLine(
                `${theme.fg("muted", ` ${submitQuestion.label}: `)}${theme.fg("text", `${prefix}${answer.label}`)}`,
              );
            }

            lines.push("");
            if (allAnswered()) {
              addLine(theme.fg("success", " Press Enter to submit"));
            } else {
              const missing = questions
                .filter((submitQuestion) => !answers.has(submitQuestion.id))
                .map((submitQuestion) => submitQuestion.label)
                .join(", ");
              addLine(theme.fg("warning", ` Unanswered: ${missing}`));
            }
          } else if (question !== undefined) {
            addLine(theme.fg("text", ` ${question.prompt}`));
            lines.push("");
            renderOptions();

            const existingAnswer = answers.get(question.id);
            if (existingAnswer !== undefined) {
              lines.push("");
              const summary = existingAnswer.wasCustom
                ? `(wrote) ${existingAnswer.label}`
                : existingAnswer.index !== undefined
                  ? `${existingAnswer.index}. ${existingAnswer.label}`
                  : existingAnswer.label;
              addLine(
                `${theme.fg("muted", " Current answer: ")}${theme.fg("dim", summary)}`,
              );
            }
          }

          lines.push("");
          if (!inputMode) {
            const helpText = isMultiQuestion
              ? " Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel"
              : " ↑↓ navigate • Enter select • Esc cancel";
            addLine(theme.fg("dim", helpText));
          }
          addLine(theme.fg("accent", border));

          cachedLines = lines;
          return lines;
        };

        return {
          get focused() {
            return focused;
          },
          set focused(nextFocused: boolean) {
            focused = nextFocused;
            editor.focused = nextFocused;
          },
          render,
          invalidate: () => {
            cachedLines = undefined;
            cachedWidth = undefined;
            editor.invalidate();
          },
          handleInput,
        };
      });

      if (result === undefined) {
        return buildCancelledResult(
          "Questionnaire custom UI is unavailable in RPC mode. Use interactive TUI mode for this tool.",
          questions,
        );
      }

      if (result.cancelled) {
        return buildToolResult(CANCELLED_TEXT, result);
      }

      return buildToolResult(
        summarizeAnswersForModel(questions, result.answers),
        result,
      );
    },

    renderCall(args, theme) {
      const labels = extractQuestionLabelsFromCallArgs(args);
      const count = labels.length;

      let text = theme.fg("toolTitle", theme.bold("questionnaire "));
      text += theme.fg(
        "muted",
        `${count} question${count === 1 ? "" : "s"}`,
      );

      if (labels.length > 0) {
        text += theme.fg("dim", ` (${truncateToWidth(labels.join(", "), 40)})`);
      }

      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = parseQuestionnaireResult(result.details);

      if (details === null) {
        const firstPart = result.content[0];
        const fallbackText =
          firstPart?.type === "text"
            ? firstPart.text
            : "Questionnaire result unavailable.";
        return new Text(fallbackText, 0, 0);
      }

      if (details.cancelled) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      }

      const questionDisplayById = buildQuestionDisplayById(details.questions);

      const lines = details.answers.map((answer) => {
        const questionLabel = questionDisplayById.get(answer.id) ?? answer.id;

        if (answer.wasCustom) {
          return `${theme.fg("success", "✓ ")}${theme.fg("accent", questionLabel)}: ${theme.fg("muted", "(wrote) ")}${answer.label}`;
        }

        const answerDisplay =
          answer.index !== undefined
            ? `${answer.index}. ${answer.label}`
            : answer.label;

        return `${theme.fg("success", "✓ ")}${theme.fg("accent", questionLabel)}: ${answerDisplay}`;
      });

      if (lines.length === 0) {
        return new Text(theme.fg("warning", "No answers recorded"), 0, 0);
      }

      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
