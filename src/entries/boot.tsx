import * as React from "react";
import * as ReactDOM from "react-dom";
import * as SDK from "azure-devops-extension-sdk";
import { IHostNavigationService } from "azure-devops-extension-api";
import { collectionUrl } from "../core/api/host";
import { StackedPrService } from "../core/api/services";
import { NavContext, Navigator, ServiceContext } from "../ui/context";
import { buildRoute, nativePrUrl, projectBaseUrl, Route } from "../ui/route";
import { watchTheme } from "../ui/theme";
import "../ui/styles.scss";


export async function navigationService(): Promise<IHostNavigationService> {
  return SDK.getService<IHostNavigationService>("ms.vss-features.host-navigation-service");
}

/** Initialises the SDK, the REST service and renders `render` once the host handshake is done. */
export async function boot(render: (ctx: { service: StackedPrService; navigator: Navigator; host: IHostNavigationService }) => React.ReactElement): Promise<void> {
  await SDK.init({ loaded: false, applyTheme: true });
  try {
    await SDK.ready();
    watchTheme();
    const service = await StackedPrService.create();
    const host = await navigationService();
    const base = projectBaseUrl(await collectionUrl(), service.ctx.projectName);

    const navigator: Navigator = {
      openPr: (repoId, prId) => goto(host, base, { kind: "pr", repoId, prId }),
      openList: () => goto(host, base, { kind: "list" }),
      nativeUrl: (repoName, prId) => nativePrUrl(base, repoName, prId),
      workItemUrl: (id) => `${base}/_workitems/edit/${id}`
    };

    const root = document.getElementById("root")!;
    ReactDOM.render(
      <ServiceContext.Provider value={service}>
        <NavContext.Provider value={navigator}>{render({ service, navigator, host })}</NavContext.Provider>
      </ServiceContext.Provider>,
      root
    );
    SDK.notifyLoadSucceeded();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    document.getElementById("root")!.innerHTML = `<div class="sp-error" style="margin:16px">Failed to start: ${msg.replace(/</g, "&lt;")}</div>`;
    SDK.notifyLoadFailed(msg);
  }
}

/** Navigation inside the hub changes the URL hash, so deep links and the back button work. */
function goto(host: IHostNavigationService, _base: string, route: Route): void {
  host.setHash(buildRoute(route));
}
