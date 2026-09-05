import { ReactNode } from "react";
import { toast } from "sonner";

type NotificationOptions = {
  icon?: string;
  duration?: number;
};

/**
 * Thin wrapper around sonner that mirrors scaffold-eth's notification API
 * (loading / success / error / remove) so the hooks keep their signatures.
 */
export const notification = {
  loading: (content: ReactNode) => {
    return toast.loading(content);
  },
  success: (content: ReactNode, options?: NotificationOptions) => {
    const id = toast.success(content, { icon: options?.icon, duration: options?.duration ?? 5_000 });
    return id;
  },
  error: (content: ReactNode, options?: NotificationOptions) => {
    const id = toast.error(content, { duration: options?.duration ?? 8_000 });
    return id;
  },
  info: (content: ReactNode, options?: NotificationOptions) => {
    const id = toast(content, { duration: options?.duration ?? 5_000 });
    return id;
  },
  remove: (id: string | number) => {
    return toast.dismiss(id);
  },
};
