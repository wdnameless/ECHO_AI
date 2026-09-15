import {
  Settings,
  Code,
  MessagesSquare,
  AudioLinesIcon,
  SquareSlashIcon,
  PowerIcon,
  BugIcon,
  GraduationCap,
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
      icon: GraduationCap,
      label: "Mock Interview",
      href: "/mock-interview",
    },
    {
      icon: MessagesSquare,
      label: "Chats",
      href: "/chats",
    },
    {
      icon: Settings,
      label: "Settings",
      href: "/settings",
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
      icon: Code,
      label: "AI & STT Providers",
      href: "/dev-space",
    },
  ];

  const footerItems = [
    {
      icon: BugIcon,
      label: "Report a bug",
      href: "https://github.com/wdnameless/ECHO_AI/issues/new",
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
