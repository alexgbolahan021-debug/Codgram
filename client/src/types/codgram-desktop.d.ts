export {};

declare global {
  interface Window {
    codgramDesktop?: {
      isDesktop: true;
      getWorkspaceState(): Promise<{ isDesktop: true; workspaceId: string | null }>;
      chooseProjectFolder(): Promise<{ cancelled: boolean; workspaceId?: string }>;
      getProviderSecretStatus(): Promise<{ available: boolean; stored: boolean; backend: string | null; message: string }>;
      saveProviderSecret(value: string): Promise<{ available: boolean; stored: boolean; backend: string | null; message: string }>;
      clearProviderSecret(): Promise<{ available: boolean; stored: boolean; backend: string | null; message: string }>;
    };
  }
}
