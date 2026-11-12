import * as React from "react";
import { StackedPrService } from "../core/api/services";
import { Route } from "./route";

export interface Navigator {
  openPr(repoId: string, prId: number): void;
  openList(): void;
  /** Real URL of a route, so in-app links support middle click, ctrl+click and "Open in new tab". */
  href(route: Route): string;
  /** URL of the native PR page, for "Open in Azure DevOps" links. */
  nativeUrl(repoName: string, prId: number): string;
  workItemUrl(id: string): string;
}

export const ServiceContext = React.createContext<StackedPrService | undefined>(undefined);
export const NavContext = React.createContext<Navigator | undefined>(undefined);

export function useService(): StackedPrService {
  const s = React.useContext(ServiceContext);
  if (!s) throw new Error("ServiceContext missing");
  return s;
}

export function useNav(): Navigator {
  const n = React.useContext(NavContext);
  if (!n) throw new Error("NavContext missing");
  return n;
}
