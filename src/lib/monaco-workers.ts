/**
 * Configure Monaco editor web workers for Vite.
 * Must be called once before creating any editor instance (e.g. in CodeEditor onMount).
 */
import type * as Monaco from 'monaco-editor';

// Vite bundles these as worker constructors
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

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
