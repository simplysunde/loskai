import { Modal } from "../shared/Modal";
import { XtermSession } from "../shared/XtermSession";
import { QuickCommands } from "./QuickCommands";

// A shell in a container, via /api/docker/containers/{id}/exec, with its quick commands.
export function Terminal({
  container,
  onClose,
}: {
  container: { id: string; name: string };
  onClose: () => void;
}) {
  return (
    <Modal title={`Terminal — ${container.name}`} onClose={onClose} wide>
      <XtermSession
        url={`/api/docker/containers/${container.id}/exec`}
        toolbar={(run) => <QuickCommands containerId={container.id} onRun={run} />}
      />
    </Modal>
  );
}
