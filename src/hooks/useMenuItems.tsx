import {
  Settings,
  MessagesSquare,
  AudioLinesIcon,
  SquareSlashIcon,
  PowerIcon,
  BugIcon,
  MicIcon,
  Sparkles,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { GithubIcon } from "@/components";

export const useMenuItems = () => {
  const menu: {
    icon: React.ElementType;
    label: string;
    href: string;
    count?: number;
  }[] = [
    {
      icon: MessagesSquare,
      label: "Chats",
      href: "/chats",
    },
    {
      icon: Sparkles,
      label: "AI",
      href: "/dev-space",
    },
    {
      icon: MicIcon,
      label: "SST Models",
      href: "/models",
    },
    {
      icon: AudioLinesIcon,
      label: "Audio",
      href: "/audio",
    },
    {
      icon: SquareSlashIcon,
      label: "Shortcuts",
      href: "/shortcuts",
    },
    {
      icon: Settings,
      label: "Settings",
      href: "/settings",
    },
  ];

  const footerItems = [
    {
      icon: BugIcon,
      label: "Report a bug",
      href: "https://github.com/wdnameless/ECHO_AI/issues",
    },
    {
      icon: PowerIcon,
      label: "Quit Echo AI",
      action: async () => {
        await invoke("exit_app");
      },
    },
  ];

  const footerLinks: {
    title: string;
    icon: React.ElementType;
    link: string;
  }[] = [
    {
      title: "Github",
      icon: GithubIcon,
      link: "https://github.com/wdnameless/ECHO_AI",
    },
  ];

  return {
    menu,
    footerItems,
    footerLinks,
  };
};
