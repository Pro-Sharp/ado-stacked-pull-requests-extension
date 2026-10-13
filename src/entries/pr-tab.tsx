import * as React from "react";
import * as SDK from "azure-devops-extension-sdk";
import { PullRequestTabExtensionConfig } from "azure-devops-extension-api/Git";
import { PullRequestView } from "../ui/pr/PullRequestView";
import { boot } from "./boot";

/**
 * Tab on the native pull request page. The host passes `{ pullRequestId, repositoryId }`;
 * the full pull request may also be present depending on the host version, so both shapes are accepted.
 */
function Tab() {
  const cfg = SDK.getConfiguration() as Partial<PullRequestTabExtensionConfig> & { pullRequest?: { pullRequestId: number; repository: { id: string } } };
  const prId = cfg.pullRequestId ?? cfg.pullRequest?.pullRequestId;
  const repoId = cfg.repositoryId ?? cfg.pullRequest?.repository?.id;
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    // Pass the current width explicitly: with `undefined` the SDK uses body.scrollWidth, which makes the iframe shrink on every resize.
    const resize = () => SDK.resize(window.innerWidth, Math.max(500, document.body.scrollHeight));
    const observer = new ResizeObserver(resize);
    if (ref.current) observer.observe(ref.current);
    resize();
    return () => observer.disconnect();
  }, []);
  if (!prId || !repoId) return <div className="sp-error">Could not determine the pull request from the host configuration.</div>;
  return (
    <div ref={ref}>
      <PullRequestView repoId={repoId} prId={prId} embedded initialTab="files" />
    </div>
  );
}

boot(() => <Tab />);
