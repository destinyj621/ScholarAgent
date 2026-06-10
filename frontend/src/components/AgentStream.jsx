import { useEffect, useRef } from "react";
import styles from "./AgentStream.module.css";

const STAGE_LABELS = {
  filter: "FilterAgent",
  estimate: "EstimatorAgent",
  schedule: "SchedulerAgent",
};

const STAGE_ORDER = ["filter", "estimate", "schedule"];

export default function AgentStream({ url, body, onNeedsInput, onComplete, onError }) {
  const outputRef = useRef(null);
  const stagesRef = useRef({ filter: "", estimate: "", schedule: "" });
  const currentStageRef = useRef(null);

  useEffect(() => {
    if (!url) return;

    let aborted = false;

    async function stream() {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const text = await resp.text();
          onError?.(`Server error: ${resp.status} — ${text}`);
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop(); // keep incomplete chunk

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (!raw) continue;

            let event;
            try {
              event = JSON.parse(raw);
            } catch {
              continue;
            }

            handleEvent(event);
          }
        }
      } catch (err) {
        if (!aborted) onError?.(err.message);
      }
    }

    function handleEvent(event) {
      const stage = event.stage;

      if (stage === "filter" || stage === "estimate" || stage === "schedule") {
        if (currentStageRef.current !== stage) {
          currentStageRef.current = stage;
        }
        stagesRef.current[stage] += event.token || "";
        renderOutput();
        // Auto-scroll
        if (outputRef.current) {
          outputRef.current.scrollTop = outputRef.current.scrollHeight;
        }
      } else if (stage === "needs_input") {
        onNeedsInput?.(event);
      } else if (stage === "complete") {
        renderOutput(true);
        onComplete?.(event);
      } else if (stage === "error") {
        onError?.(event.message);
      }
    }

    function renderOutput(done = false) {
      if (!outputRef.current) return;
      let html = "";
      for (const s of STAGE_ORDER) {
        if (!stagesRef.current[s]) continue;
        const isActive = currentStageRef.current === s && !done;
        html += `<div class="${styles.stageBlock}">`;
        html += `<div class="${styles.stageLabel}${isActive ? " " + styles.active : ""}">${STAGE_LABELS[s]}</div>`;
        html += `<pre class="${styles.stageText}">${escapeHtml(stagesRef.current[s])}</pre>`;
        html += `</div>`;
      }
      outputRef.current.innerHTML = html;
    }

    stream();
    return () => { aborted = true; };
  }, [url]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>Agent Reasoning</div>
      <div className={styles.output} ref={outputRef} />
    </div>
  );
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
