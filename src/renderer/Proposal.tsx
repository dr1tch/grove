import { useState } from "react";
import { diffLines } from "diff";
import type { AgentReply } from "../shared/types";
export function Proposal({
  proposal,
  vaultRoot,
  onApplied,
}: {
  vaultRoot: string;
  proposal: AgentReply["proposals"][number];
  onApplied: () => void;
}) {
  const [state, setState] = useState("pending");
  const [error, setError] = useState("");
  const [before, setBefore] = useState<string | null>(null);
  async function accept() {
    setError("");
    try {
      if (proposal.verb === "create")
        await window.folio.create(proposal.path, proposal.content!, vaultRoot);
      else if (proposal.verb === "delete")
        await window.folio.trash(proposal.path, proposal.baseHash!, vaultRoot);
      else {
        const result = await window.folio.write(
          proposal.path,
          proposal.content!,
          proposal.baseHash!,
          vaultRoot,
        );
        if (result.status === "conflict")
          throw new Error(
            "This file changed on disk. Nothing was applied. Ask for a fresh proposal.",
          );
      }
      setState("applied");
      onApplied();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <div className="proposal">
      <header>
        <b className={proposal.verb === "delete" ? "danger-text" : ""}>
          {proposal.verb.toUpperCase()}
        </b>
        <span>{proposal.path}</span>
      </header>
      {proposal.reason && <p>{proposal.reason}</p>}
      {proposal.verb === "update" &&
        state === "pending" &&
        (before === null ? (
          <button
            onClick={() =>
              void window.folio
                .read(proposal.path)
                .then((d) => setBefore(d.content))
                .catch((e) => setError(String(e)))
            }
          >
            Review diff
          </button>
        ) : (
          <pre>
            {diffLines(before, proposal.content || "").map((part, i) => (
              <span key={i} className={part.added ? "diff-add" : part.removed ? "diff-del" : ""}>
                {part.value}
              </span>
            ))}
          </pre>
        ))}
      {proposal.verb === "create" && <pre>{proposal.content}</pre>}
      {proposal.verb === "delete" && <p>Moves to Trash. The file can be restored.</p>}
      {error && (
        <p className="danger-text" role="alert">
          {error}
        </p>
      )}
      <footer>
        {state === "pending" ? (
          <>
            <button onClick={() => setState("rejected")}>Reject</button>
            <button className="primary" onClick={() => void accept()}>
              {proposal.verb === "delete"
                ? "Move to Trash"
                : proposal.verb === "create"
                  ? "Create file"
                  : "Accept"}
            </button>
          </>
        ) : (
          <span>
            {state === "applied" ? "✓ Applied · saved in history" : "Rejected · file unchanged"}
          </span>
        )}
      </footer>
    </div>
  );
}
