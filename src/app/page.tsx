import { CommandCenter } from "@/components/saos/command-center";

/**
 * SAOS Sovereign Foundry — מרכז שליטה מבצעי (Task 10 rebuild).
 * The shell is a server component; every panel inside fetches live data
 * from /api/saos/* on the client with loading/error/empty discipline.
 */
export default function Page() {
  return <CommandCenter />;
}
