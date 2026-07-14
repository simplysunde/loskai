import { useEffect, useRef, useState } from "react";

import { Modal } from "../shared/Modal";

// Streams container logs over SSE (GET /api/docker/containers/{id}/logs). EventSource
// carries the session cookie automatically (same-origin).
export function LogViewer({
  container,
  onClose,
}: {
  container: { id: string; name: string };
  onClose: () => void;
}) {
  const [lines, setLines] = useState<string[]>([]);
  const boxRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const es = new EventSource(`/api/docker/containers/${container.id}/logs`);
    es.onmessage = (e) => setLines((prev) => [...prev.slice(-2000), e.data]);
    es.onerror = () => es.close();
    return () => es.close();
  }, [container.id]);

  useEffect(() => {
    boxRef.current?.scrollTo(0, boxRef.current.scrollHeight);
  }, [lines]);

  return (
    <Modal title={`Logs — ${container.name}`} onClose={onClose} wide>
      <pre
        ref={boxRef}
        className="max-h-[60vh] overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-300"
      >
        {lines.length ? lines.join("\n") : "Waiting for logs…"}
      </pre>
    </Modal>
  );
}
