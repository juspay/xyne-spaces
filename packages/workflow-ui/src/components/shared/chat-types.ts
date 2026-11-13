/** A tool invocation shown as a live chip while a chat turn streams. */
export interface StreamingTool {
  id: string;
  name: string;
  done: boolean;
  isError?: boolean | undefined;
}

/** In-progress assistant turn: the latest text snapshot + active tool chips. */
export interface StreamingState {
  text: string;
  tools: StreamingTool[];
}
