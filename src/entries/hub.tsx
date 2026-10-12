import * as React from "react";
import { IHostNavigationService } from "azure-devops-extension-api";
import { PullRequestView, PrTab } from "../ui/pr/PullRequestView";
import { StackList } from "../ui/list/StackList";
import { buildRoute, parseRoute, Route } from "../ui/route";
import { boot } from "./boot";

function Hub({ host }: { host: IHostNavigationService }) {
  const [route, setRoute] = React.useState<Route>({ kind: "list" });
  React.useEffect(() => {
    host.getHash().then((h) => setRoute(parseRoute(h)));
    host.onHashChanged((h) => setRoute(parseRoute(h)));
  }, []);

  if (route.kind === "pr") {
    return <PullRequestView key={`${route.repoId}/${route.prId}`} repoId={route.repoId} prId={route.prId} initialTab={(route.tab as PrTab) || "overview"} onTabChange={(tab) => host.setHash(buildRoute({ ...route, tab }))} />;
  }
  return <StackList />;
}

boot(({ host }) => <Hub host={host} />);
