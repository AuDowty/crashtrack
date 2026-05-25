import { Link } from "react-router-dom";
import { AlertOctagon, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = 404 | 401 | 403 | 429 | 500;

const COPY: Record<Status, { title: string; body: string }> = {
  404: {
    title: "page not found",
    body: "the url doesn't match anything here. it might have moved, or never existed.",
  },
  401: {
    title: "sign in required",
    body: "this page needs an authenticated session.",
  },
  403: {
    title: "no access",
    body: "your account isn't allowed here. ask an org owner to add you, or use a different account.",
  },
  429: {
    title: "slow down a sec",
    body: "we're rate-limiting requests to keep costs in check. give it a minute and try again.",
  },
  500: {
    title: "something broke on our end",
    body: "this isn't your fault. the error has been logged and we'll look at it.",
  },
};

export function ErrorPage({
  status = 500,
  message,
}: {
  status?: Status;
  message?: string;
}) {
  const copy = COPY[status];
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <AlertOctagon className="size-12 text-destructive mb-4" />
      <div className="text-sm font-mono text-muted-foreground mb-2">{status}</div>
      <h1 className="text-3xl font-semibold mb-3">{copy.title}</h1>
      <p className="text-muted-foreground max-w-md mb-8">{message ?? copy.body}</p>
      <div className="flex gap-3">
        <Link
          to="/"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Home className="size-4" /> home
        </Link>
        <Button variant="outline" onClick={() => window.history.back()}>
          go back
        </Button>
      </div>
    </div>
  );
}
