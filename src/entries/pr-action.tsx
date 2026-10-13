import * as SDK from "azure-devops-extension-sdk";
import { IHostNavigationService, IProjectPageService } from "azure-devops-extension-api";
import { collectionUrl } from "../core/api/host";
import { hubUrl, projectBaseUrl } from "../ui/route";
import { HUB_CONTRIBUTION } from "./constants";

/** Shape of the context the host passes to PR "..." menu actions; both layouts are handled defensively. */
interface PrActionContext {
  pullRequest?: { pullRequestId: number; repository?: { id: string } };
  pullRequestId?: number;
  repositoryId?: string;
  repository?: { id: string };
}

async function open(ctx: PrActionContext): Promise<void> {
  const prId = ctx.pullRequest?.pullRequestId ?? ctx.pullRequestId;
  const repoId = ctx.pullRequest?.repository?.id ?? ctx.repository?.id ?? ctx.repositoryId;
  if (!prId || !repoId) return;
  const project = await (await SDK.getService<IProjectPageService>("ms.vss-tfs-web.tfs-page-data-service")).getProject();
  const nav = await SDK.getService<IHostNavigationService>("ms.vss-features.host-navigation-service");
  const ext = SDK.getExtensionContext();
  const base = projectBaseUrl(await collectionUrl(), project!.name);
  nav.navigate(hubUrl(base, ext.publisherId, ext.extensionId, HUB_CONTRIBUTION, { kind: "pr", repoId, prId }));
}


SDK.init({ loaded: false }).then(() => {
  SDK.register("stacked-prs-pr-action-handler", { execute: (ctx: PrActionContext) => void open(ctx) });
  SDK.notifyLoadSucceeded();
});
