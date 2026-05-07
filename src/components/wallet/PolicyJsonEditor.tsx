import { useEffect, useRef, useState } from 'react';

interface PolicyJsonEditorProps {
  policyJsonText: string;
  onChangeText: (text: string) => void;
  jsonEdited: boolean;
  onReset: () => void;
}

export function PolicyJsonEditor({ policyJsonText, onChangeText, jsonEdited, onReset }: PolicyJsonEditorProps) {
  const [expanded, setExpanded] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [expandedJson, setExpandedJson] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // When expanded, keep expandedJson in sync with form-driven policyJsonText changes
  useEffect(() => {
    if (expanded && !jsonEdited) {
      try {
        const parsed = JSON.parse(policyJsonText);
        setExpandedJson(JSON.stringify(parsed, null, 2));
        setJsonError(null);
      } catch {
        setExpandedJson(policyJsonText);
      }
    }
  }, [expanded, policyJsonText, jsonEdited]);

  // Sync scroll between line numbers and textarea
  const handleScroll = () => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const handleTextChange = (text: string) => {
    setExpandedJson(text);
    // Validate on change
    try {
      JSON.parse(text);
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
    onChangeText(text);
  };

  const lineCount = expandedJson.split('\n').length;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-sm text-zinc-900 hover:text-zinc-600 font-medium"
        >
          <span className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
          Policy JSON
        </button>
        {jsonEdited && (
          <button
            type="button"
            onClick={onReset}
            className="text-xs text-zinc-500 hover:text-zinc-900 font-medium"
          >
            Reset to form defaults
          </button>
        )}
      </div>

      {!expanded ? (
        <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3 max-h-48 overflow-auto">
          <pre className="text-xs text-zinc-600 whitespace-pre-wrap break-all font-mono">
            {(() => {
              try {
                const parsed = JSON.parse(policyJsonText);
                return JSON.stringify(parsed, null, 2);
              } catch {
                return policyJsonText;
              }
            })()}
          </pre>
        </div>
      ) : (
        <div>
          {jsonError && (
            <div className="mb-2 bg-red-50 border-l-4 border-red-400 rounded-r-lg p-2">
              <p className="text-xs text-red-700">Invalid JSON: {jsonError}</p>
            </div>
          )}
          <div className="border border-zinc-200 rounded-lg overflow-hidden bg-zinc-50">
            <div className="flex">
              {/* Line numbers */}
              <div
                ref={lineNumbersRef}
                className="bg-zinc-100 border-r border-zinc-200 px-3 py-3 text-right select-none overflow-hidden flex-shrink-0"
                style={{ minWidth: '3rem' }}
              >
                {Array.from({ length: lineCount }, (_, i) => (
                  <div key={i} className="text-xs text-zinc-400 font-mono leading-5">
                    {i + 1}
                  </div>
                ))}
              </div>
              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={expandedJson}
                onChange={(e) => handleTextChange(e.target.value)}
                onScroll={handleScroll}
                className="flex-1 bg-transparent p-3 text-xs text-zinc-800 font-mono leading-5 resize-none focus:outline-none min-h-[300px]"
                spellCheck={false}
              />
            </div>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            Edit the JSON directly. Changes here override the form fields above.
          </p>
        </div>
      )}
    </div>
  );
}
