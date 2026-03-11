import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// call once before creating any monaco editor (e.g. in CodeEditor onMount); vite bundles the ?worker imports
export function initMonacoWorkers(): void {
  if (typeof self === 'undefined') return;
  const g = self as unknown as { MonacoEnvironment?: { getWorker: (module: string, label: string) => Worker } };
  if (g.MonacoEnvironment) return;
  g.MonacoEnvironment = {
    getWorker: (_: string, label: string): Worker => {
      switch (label) {
        case 'json':
          return new (JsonWorker as new () => Worker)();
        case 'css':
        case 'scss':
        case 'less':
          return new (CssWorker as new () => Worker)();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new (HtmlWorker as new () => Worker)();
        case 'typescript':
        case 'javascript':
          return new (TsWorker as new () => Worker)();
        default:
          return new (EditorWorker as new () => Worker)();
      }
    }
  };
}
