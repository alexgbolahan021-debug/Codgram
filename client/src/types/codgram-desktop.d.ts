export {};

declare global {
  interface Window {
    codgramDesktop?: {
      isDesktop: true;
      getWorkspaceState(): Promise<{ isDesktop: true; workspaceId: string | null }>;
      chooseProjectFolder(): Promise<{ cancelled: boolean; workspaceId?: string }>;
    };
  }
}
