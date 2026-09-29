import { useEffect, useState } from "react";
import { subscribeApiBusy } from "@/lib/apiBusy";

/**
 * Slim indeterminate progress bar fixed to the top of the viewport.
 *
 * Appears whenever at least one tRPC request is in flight (queries AND
 * mutations — mutations were previously invisible: pressing Verify, Add
 * person, Record donation etc. just sat still until the toast). Pairs with
 * the per-button spinners that already exist on some actions.
 */
export default function TopProgressBar() {
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    return subscribeApiBusy(count => {
      setBusy(count > 0);
    });
  }, []);

  // Mount/unmount separately: the fade-out transition needs the element to
  // stay in the DOM briefly after busy turns false.
  useEffect(() => {
    if (busy) {
      setVisible(true);
      return;
    }
    const t = setTimeout(() => setVisible(false), 320);
    return () => clearTimeout(t);
  }, [busy]);

  if (!visible) return null;

  return (
    <div
      className={`top-progress-bar${busy ? " active" : ""}`}
      role="progressbar"
      aria-label="Loading"
    />
  );
}
