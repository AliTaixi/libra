"use client";

import type { ChatStatus } from "ai";
import {
  CheckIcon,
  FolderOpenIcon,
  Loader2Icon,
  MicIcon,
  PaperclipIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";

import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";

import { toast } from "sonner";

import { useModels } from "@/core/models/hooks";
import type { AgentThreadContext } from "@/core/threads";
import { cn } from "@/lib/utils";

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "../ai-elements/model-selector";

import { Tooltip } from "./tooltip";
import { UserFileSelectDialog } from "./user-file-select-dialog";
import { useWhisperRecorder } from "@/hooks/use-whisper-recorder";

export function InputBox({
  className,
  disabled,
  autoFocus,
  status = "ready",
  context,
  extraHeader,
  isWelcomeMode,
  threadId,
  initialValue,
  onContextChange,
  onSubmit,
  onStop,
  ...props
}: Omit<ComponentProps<typeof PromptInput>, "onSubmit"> & {
  assistantId?: string | null;
  status?: ChatStatus;
  disabled?: boolean;
  context: Omit<
    AgentThreadContext,
    "thread_id" | "is_plan_mode" | "subagent_enabled"
  >;
  extraHeader?: React.ReactNode;
  /**
   * Whether to render the input in welcome layout (vertically centered,
   * with hero + quick action suggestions).  This is purely a visual flag,
   * decoupled from "the backend has created the thread" — see issue #2746.
   */
  isWelcomeMode?: boolean;
  threadId: string;
  initialValue?: string;
  onContextChange?: (
    context: Omit<
      AgentThreadContext,
      "thread_id" | "is_plan_mode" | "subagent_enabled"
    >,
  ) => void;
  onSubmit?: (message: PromptInputMessage) => void;
  onStop?: () => void;
}) {
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const [fileSelectOpen, setFileSelectOpen] = useState(false);
  const [referencedFiles, setReferencedFiles] = useState<
    { filename: string; size: number }[]
  >([]);
  const { models } = useModels();
  const promptRootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (models.length === 0) {
      return;
    }
    const currentModel = models.find((m) => m.name === context.model_name);
    const fallbackModel = currentModel ?? models[0]!;
    const nextModelName = fallbackModel.name;

    if (context.model_name === nextModelName) {
      return;
    }

    onContextChange?.({
      ...context,
      model_name: nextModelName,
    });
  }, [context, models, onContextChange]);

  const selectedModel = useMemo(() => {
    if (models.length === 0) {
      return undefined;
    }
    return models.find((m) => m.name === context.model_name) ?? models[0];
  }, [context.model_name, models]);

  const resolvedModelName = selectedModel?.name;

  const handleModelSelect = useCallback(
    (model_name: string) => {
      onContextChange?.({
        ...context,
        model_name,
      });
      setModelDialogOpen(false);
    },
    [onContextChange, context],
  );

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (status === "streaming") {
        onStop?.();
        return;
      }
      if (!message.text && referencedFiles.length === 0) {
        return;
      }

      // Inject file references directly into message text
      let text = message.text;
      if (referencedFiles.length > 0) {
        const refBlock = referencedFiles
          .map((ref) => `/mnt/user-data/${ref.filename}`)
          .join("\n");
        text = text
          ? `${text}\n\n<user_files>\n${refBlock}\n</user_files>`
          : `<user_files>\n${refBlock}\n</user_files>`;
      }

      // Guard against submitting before the initial model auto-selection
      // effect has flushed thread settings to storage/state.
      if (resolvedModelName && context.model_name !== resolvedModelName) {
        onContextChange?.({
          ...context,
          model_name: resolvedModelName,
        });
        setTimeout(() => onSubmit?.({ ...message, text }), 0);
        return;
      }

      onSubmit?.({ ...message, text });
      setReferencedFiles([]);
    },
    [
      context,
      onContextChange,
      onSubmit,
      onStop,
      resolvedModelName,
      status,
      referencedFiles,
    ],
  );

  return (
    <div
      ref={promptRootRef}
      className={cn(
        "relative flex flex-col",
        isWelcomeMode ? "gap-4" : "gap-2",
      )}
    >
      <PromptInput
        className={cn(
          "bg-background/85 rounded-2xl backdrop-blur-sm transition-all duration-300 ease-out *:data-[slot='input-group']:rounded-2xl",
          className,
        )}
        disabled={disabled}
        globalDrop
        multiple
        onSubmit={handleSubmit}
        {...props}
      >
        {extraHeader && (
          <div className="absolute top-0 right-0 left-0 z-10">
            <div className="absolute right-0 bottom-0 left-0 flex items-center justify-center">
              {extraHeader}
            </div>
          </div>
        )}
        <PromptInputAttachments>
          {(attachment) => <PromptInputAttachment data={attachment} />}
        </PromptInputAttachments>

        {referencedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-1">
            {referencedFiles.map((ref) => (
              <span
                key={ref.filename}
                className="bg-muted text-muted-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
              >
                📎 {ref.filename}
                <button
                  type="button"
                  className="hover:text-foreground ml-0.5 leading-none"
                  onClick={() =>
                    setReferencedFiles((prev) =>
                      prev.filter((f) => f.filename !== ref.filename),
                    )
                  }
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <PromptInputBody className="absolute top-0 right-0 left-0 z-3">
          <PromptInputTextarea
            className={cn("size-full")}
            disabled={disabled}
            placeholder={"今天我能为你做些什么？"}
            autoFocus={autoFocus}
            defaultValue={initialValue}
          />
        </PromptInputBody>
        <PromptInputFooter className="flex">
          <PromptInputTools>
            <WhisperMicButton />
            <AddAttachmentsButton className="px-2!" />
            <SelectFromUserDataButton
              threadId={threadId}
              onFileRef={(filename, size) =>
                setReferencedFiles((prev) => {
                  if (prev.some((f) => f.filename === filename)) return prev;
                  return [...prev, { filename, size }];
                })
              }
            />
          </PromptInputTools>
          <PromptInputTools>
            <ModelSelector
              open={modelDialogOpen}
              onOpenChange={setModelDialogOpen}
            >
              <ModelSelectorTrigger asChild>
                <PromptInputButton>
                  <div className="flex min-w-0 flex-col items-start text-left">
                    <ModelSelectorName className="text-xs font-normal">
                      {selectedModel?.display_name}
                    </ModelSelectorName>
                  </div>
                </PromptInputButton>
              </ModelSelectorTrigger>
              <ModelSelectorContent>
                <ModelSelectorInput placeholder={"搜索模型..."} />
                <ModelSelectorList>
                  {models.map((m) => (
                    <ModelSelectorItem
                      key={m.name}
                      value={m.name}
                      onSelect={() => handleModelSelect(m.name)}
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <ModelSelectorName>{m.display_name}</ModelSelectorName>
                        <span className="text-muted-foreground truncate text-[10px]">
                          {m.model}
                        </span>
                      </div>
                      {m.name === context.model_name ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </ModelSelectorItem>
                  ))}
                </ModelSelectorList>
              </ModelSelectorContent>
            </ModelSelector>
            <PromptInputSubmit
              className="rounded-full"
              disabled={disabled}
              variant="outline"
              status={status}
            />
          </PromptInputTools>
        </PromptInputFooter>
        {!isWelcomeMode && (
          <div className="bg-background absolute right-0 -bottom-[17px] left-0 z-0 h-4"></div>
        )}
      </PromptInput>
    </div>
  );
}

function AddAttachmentsButton({ className }: { className?: string }) {
  const attachments = usePromptInputAttachments();
  return (
    <Tooltip content={"添加附件"}>
      <PromptInputButton
        className={cn("px-2!", className)}
        onClick={() => attachments.openFileDialog()}
      >
        <PaperclipIcon className="size-3" />
      </PromptInputButton>
    </Tooltip>
  );
}

/**
 * 麦克风按钮 — 录音后通过 Whisper ASR 转写，将文本插入输入框。
 */
function WhisperMicButton() {
  const controller = usePromptInputController();
  const {
    status,
    isRecording,
    isTranscribing,
    startRecording,
    stopAndTranscribe,
    error,
  } = useWhisperRecorder();
  const toastShownRef = useRef(false);

  // 错误 toast（只弹一次）
  useEffect(() => {
    if (status === "error" && error && !toastShownRef.current) {
      toastShownRef.current = true;
      toast.error(error);
    }
    if (status === "idle" || status === "recording") {
      toastShownRef.current = false;
    }
  }, [status, error]);

  const handleClick = async () => {
    if (isRecording) {
      // 停止录音 → 转写 → 插入文本
      const result = await stopAndTranscribe();
      if (result?.text) {
        const currentValue = controller.textInput.value;
        const separator = currentValue && !currentValue.endsWith(" ") ? " " : "";
        controller.textInput.setInput(currentValue + separator + result.text);
      }
    } else {
      await startRecording();
    }
  };

  const tooltipContent = isRecording
    ? "点击完成录音并转写"
    : isTranscribing
      ? "正在转写..."
      : "语音输入";

  return (
    <Tooltip content={tooltipContent}>
      <PromptInputButton
        className={cn(
          "relative transition-all duration-200",
          isRecording &&
            "bg-destructive/20 text-destructive data-[hover]:bg-destructive/30",
        )}
        disabled={isTranscribing}
        onClick={handleClick}
      >
        {isTranscribing ? (
          <Loader2Icon className="size-3 animate-spin" />
        ) : (
          <MicIcon
            className={cn("size-3", isRecording && "text-destructive")}
          />
        )}
      </PromptInputButton>
    </Tooltip>
  );
}

function SelectFromUserDataButton({
  threadId,
  onFileRef,
}: {
  threadId: string;
  onFileRef: (filename: string, size: number) => void;
}) {
  const [open, setOpen] = useState(false);

  const handleSelect = useCallback(
    async ({
      filename,
      size,
    }: {
      filename: string;
      url: string;
      size?: number;
    }) => {
      setOpen(false);
      onFileRef(filename, typeof size === "number" ? size : Number(size) || 0);
      toast.success(`已引用: ${filename}`);
    },
    [onFileRef],
  );

  return (
    <>
      <Tooltip content={"从用户文件中选择"}>
        <PromptInputButton
          className="px-2!"
          onClick={() => setOpen(true)}
        >
          <FolderOpenIcon className="size-3" />
        </PromptInputButton>
      </Tooltip>
      <UserFileSelectDialog
        open={open}
        onOpenChange={setOpen}
        onSelect={handleSelect}
      />
    </>
  );
}
