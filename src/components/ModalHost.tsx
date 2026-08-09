import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { _subscribeModal, type ModalRequest } from "@/lib/modal";

function requestIsCurrent(request: ModalRequest): boolean {
  if (!request.isCurrent) return true;
  try {
    return request.isCurrent();
  } catch {
    // Ownership predicates are safety gates; uncertainty fails closed.
    return false;
  }
}

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
  const defaultBtnRef = useRef<HTMLButtonElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<ModalRequest | null>(null);
  const queueRef = useRef<ModalRequest[]>([]);
  const subscriptionGenerationRef = useRef(0);
  const isFocusSessionActiveRef = useRef(false);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const restoreSessionFocus = useCallback(() => {
    if (!isFocusSessionActiveRef.current) return;
    const target = returnFocusRef.current;
    isFocusSessionActiveRef.current = false;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }, []);

  const show = useCallback((next: ModalRequest | null) => {
    let current = next;
    while (current && !requestIsCurrent(current)) {
      current.resolve(null);
      current = queueRef.current.shift() ?? null;
    }
    currentRef.current = current;
    setReq(current);
    setError(null);
    if (current?.kind === "prompt") setValue(current.defaultValue);
  }, []);

  useEffect(() => {
    const generation = ++subscriptionGenerationRef.current;
    const unsubscribe = _subscribeModal((incoming) => {
      if (!incoming) return;
      // Reject stale work before applying queue/preemption policy. A queued
      // watcher request that already lost its tab must not evict a valid update
      // offer merely to be dropped by show().
      if (!requestIsCurrent(incoming)) {
        incoming.resolve(null);
        return;
      }
      const current = currentRef.current;
      if (!current) {
        show(incoming);
        return;
      }

      // Automatic update offers are the only replaceable requests. They never
      // hide or queue behind a real user dialog; a normal request may preempt an
      // unattended offer. Normal notices/prompts queue FIFO so none disappear.
      if (incoming.policy === "replaceable") {
        incoming.resolve(null);
      } else if (current.policy === "replaceable") {
        current.resolve(null);
        show(incoming);
      } else {
        queueRef.current.push(incoming);
      }
    });

    return () => {
      unsubscribe();
      // React Strict Mode replays effect setup/cleanup in development. Defer
      // teardown by one microtask so that replay can establish the next
      // generation without dismissing the active modal. A real unmount has no
      // successor generation, so every pending promise is still settled.
      queueMicrotask(() => {
        if (subscriptionGenerationRef.current !== generation) return;
        currentRef.current?.resolve(null);
        for (const pending of queueRef.current) pending.resolve(null);
        currentRef.current = null;
        queueRef.current = [];
        restoreSessionFocus();
      });
    };
  }, [restoreSessionFocus, show]);

  useLayoutEffect(() => {
    const current = currentRef.current;
    // Ownership can expire after a request reaches the screen (for example,
    // when a shared editor instance loads another tab). Recheck on every host
    // render and retire only the request represented by this DOM.
    if (!req || !current || current.id !== req.id || requestIsCurrent(current)) return;
    current.resolve(null);
    show(queueRef.current.shift() ?? null);
  });

  useLayoutEffect(() => {
    if (!req) return;
    const backdrop = backdropRef.current;
    if (!backdrop) return;
    if (!isFocusSessionActiveRef.current) {
      isFocusSessionActiveRef.current = true;
      returnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    }
    const background = Array.from(backdrop.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => (
        element instanceof HTMLElement && element !== backdrop
      ))
      .map((element) => ({
        element,
        inert: element.inert ?? false,
        ariaHidden: element.getAttribute("aria-hidden"),
      }));
    for (const { element } of background) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    if (req.kind === "prompt") inputRef.current?.select();
    else defaultBtnRef.current?.focus(); // focus the safe-default button

    return () => {
      for (const { element, inert, ariaHidden } of background) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      if (!currentRef.current) restoreSessionFocus();
    };
  }, [req, restoreSessionFocus]);

  const close = useCallback(
    (requestId: number, result: string | null) => {
      const current = currentRef.current;
      // A preempted modal can still have a stale DOM event in flight. Never let
      // it close the replacement request.
      if (!current || current.id !== requestId) return;
      current.resolve(result);
      show(queueRef.current.shift() ?? null);
    },
    [show],
  );

  if (!req) return null;

  const inputId = `markd-modal-input-${req.id}`;
  const errorId = `markd-modal-error-${req.id}`;
  const messageId = `markd-modal-message-${req.id}`;

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
    close(req.id, v);
  };

  return (
    <div
      ref={backdropRef}
      className="markd-modal-backdrop markd-modal-host-backdrop"
      onMouseDown={() => close(req.id, null)}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div
        className={`markd-modal ${req.kind === "confirm" && req.tone ? `tone-${req.tone}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={req.title}
        aria-describedby={req.kind === "confirm" ? messageId : undefined}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            const focusable = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
              ),
            ).filter((element) => element.getAttribute("aria-hidden") !== "true");
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) {
              e.preventDefault();
              e.currentTarget.focus();
            } else if (
              e.shiftKey &&
              (document.activeElement === first || !e.currentTarget.contains(document.activeElement))
            ) {
              e.preventDefault();
              last.focus();
            } else if (
              !e.shiftKey &&
              (document.activeElement === last || !e.currentTarget.contains(document.activeElement))
            ) {
              e.preventDefault();
              first.focus();
            }
          } else if (e.key === "Escape") {
            e.preventDefault();
            close(req.id, null);
          } else if (e.key === "Enter" && req.kind === "confirm") {
            // Enter activates the safe default (e.g. Cancel), not a destructive button.
            e.preventDefault();
            close(req.id, req.defaultValue);
          }
        }}
      >
        <div className="markd-modal-title">{req.title}</div>

        {req.kind === "prompt" ? (
          <>
            {req.label && (
              <label className="markd-modal-label" htmlFor={inputId}>
                {req.label}
              </label>
            )}
            <input
              id={inputId}
              ref={inputRef}
              className="markd-modal-input"
              aria-label={req.label ? undefined : req.title}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? errorId : undefined}
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
            {error && (
              <div id={errorId} className="markd-modal-error" role="alert">
                {error}
              </div>
            )}
            <div className="markd-modal-buttons">
              <button className="markd-modal-btn" onClick={() => close(req.id, null)}>
                Cancel
              </button>
              <button className="markd-modal-btn primary" onClick={submitPrompt}>
                {req.okLabel}
              </button>
            </div>
          </>
        ) : (
          <>
            <div id={messageId} className="markd-modal-message">{req.message}</div>
            <div className="markd-modal-buttons">
              {req.buttons.map((b) => (
                <button
                  key={b.value}
                  ref={b.value === req.defaultValue ? defaultBtnRef : undefined}
                  className={`markd-modal-btn ${b.variant ?? ""}`}
                  onClick={() => close(req.id, b.value)}
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
