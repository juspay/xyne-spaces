import { ServerBlockNoteEditor } from '@blocknote/server-util';
type Editor = ReturnType<typeof ServerBlockNoteEditor.create>;

let sharedEditor: Editor | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getEditor(): Editor {
  if (!sharedEditor) {
    sharedEditor = ServerBlockNoteEditor.create();
  }
  return sharedEditor;
}

export function withServerEditor<T>(fn: (editor: Editor) => Promise<T>): Promise<T> {
  const run = queue.then(() => fn(getEditor()));
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
