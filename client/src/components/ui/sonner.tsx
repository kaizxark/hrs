import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      richColors
      closeButton
      style={
        {
          // Solid, opaque toast surfaces (never transparent).
          "--normal-bg": "#ffffff",
          "--normal-border": "#dfe4df",
          "--normal-text": "#242723",
          "--normal-bg-hover": "#f2f5f2",
          "--normal-border-hover": "#cfd8cf",
          // Success → green
          "--success-bg": "#16a34a",
          "--success-border": "#15803d",
          "--success-text": "#ffffff",
          // Info → blue
          "--info-bg": "#2563eb",
          "--info-border": "#1d4ed8",
          "--info-text": "#ffffff",
          // Warning → amber
          "--warning-bg": "#d97706",
          "--warning-border": "#b45309",
          "--warning-text": "#ffffff",
          // Error → red
          "--error-bg": "#dc2626",
          "--error-border": "#b91c1c",
          "--error-text": "#ffffff",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };