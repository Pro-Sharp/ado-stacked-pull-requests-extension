import * as React from "react";
import * as ReactDOM from "react-dom";
import { PullRequestView } from "../ui/pr/PullRequestView";
import { StackList } from "../ui/list/StackList";
import { NavContext, ServiceContext } from "../ui/context";
import { buildRoute, parseRoute, Route } from "../ui/route";
import { createMockService } from "./mockService";
import { watchTheme } from "../ui/theme";
import "../ui/styles.scss";

/** Visual harness: runs the real UI against mock data, outside Azure DevOps. */
watchTheme();
const service = createMockService();

function App() {
  const [route, setRoute] = React.useState<Route>(parseRoute(location.hash));
  React.useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const nav = {
    openPr: (repoId: string, prId: number) => { location.hash = buildRoute({ kind: "pr", repoId, prId }); },
    openList: () => { location.hash = buildRoute({ kind: "list" }); },
    nativeUrl: (repo: string, id: number) => `https://dev.azure.com/org/proj/_git/${repo}/pullrequest/${id}`,
    workItemUrl: (id: string) => `https://dev.azure.com/org/proj/_workitems/edit/${id}`
  };
  return (
    <ServiceContext.Provider value={service}>
      <NavContext.Provider value={nav}>
        {route.kind === "pr" ? <PullRequestView key={`${route.repoId}/${route.prId}`} repoId={route.repoId} prId={route.prId} initialTab={(route.tab as never) || "overview"} onTabChange={(tab) => { location.hash = buildRoute({ ...route, tab }); }} /> : <StackList />}
      </NavContext.Provider>
    </ServiceContext.Provider>
  );
}

ReactDOM.render(<App />, document.getElementById("root"));
