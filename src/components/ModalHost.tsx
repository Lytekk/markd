import { useEffect, useRef, useState, useCallback } from "react";
import { _subscribeModal, type ModalRequest } from "@/lib/modal";

/**
 * Single mount point for in-app prompt/confirm modals. Renders ordinary DOM
 * (immune to WebView2's native-dialog suppression). Escape / backdrop click
 * cancels; Enter submits a prompt.
 */
export function ModalHost() {
  const [req, setReq] = useState<ModalRequest | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      _subscribeModal((r) => {
        setReq(r);
        setError(null);
        if (r?.kind === "prompt") setValue(r.defaultValue);
      }),
    [],
  );

  useEffect(() => {
    if (req?.kind === "prompt") {
      const id = requestAnimationFrame(() => inputRef.current?.select());
      return () => cancelAnimationFrame(id);
    }
  }, [req]);

  const close = useCallback(
    (result: string | null) => {
      setReq((current) => {
        current?.resolve(result);
        return null;
      });
    },
    [],
  );

  if (!req) return null;

  const submitPrompt = () => {
    if (req.kind !== "prompt") return;
    const v = value.trim();
    if (req.validate) {
      const e = req.validate(v);
      if (e) {
        setError(e);
        return;
      }
    }
    close(v);
  };

  return (
    <div className="markd-modal-backdrop" onMouseDown={() => close(null)}>
      <div
        className="markd-modal"
        role="dialog"
        aria-modal="true"
        aria-label={req.title}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            close(null);
          }
        }}
      >
        <div className="markd-modal-title">{req.title}</div>

        {req.kind === "prompt" ? (
          <>
            {req.label && <label className="markd-modal-label">{req.label}</label>}
            <input
              ref={inputRef}
              className="markd-modal-input"
              value={value}
              placeholder={req.placeholder}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitPrompt();
                }
              }}
            />
            {error && <div className="markd-modal-error">{error}</div>}
            <div className="markd-modal-buttons">
              <button className="markd-modal-btn" onClick={() => close(null)}>
                Cancel
              </button>
              <button className="markd-modal-btn primary" onClick={submitPrompt}>
                {req.okLabel}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="markd-modal-message">{req.message}</div>
            <div className="markd-modal-buttons">
              {req.buttons.map((b) => (
                <button
                  key={b.value}
                  className={`markd-modal-btn ${b.variant ?? ""}`}
                  onClick={() => close(b.value)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
