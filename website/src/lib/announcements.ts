import type { Messages } from "./locales";

export interface Announcement {
  id: string;
  messageKey: keyof Messages;
  link?: string;
  date: string;
  active: boolean;
}

export const ANNOUNCEMENTS: Announcement[] = [
  {
    id: "logo-vote-active",
    messageKey: "announcement.4",
    link: "/logo-vote",
    date: "2026-07-15",
    active: true,
  },
  {
    id: "telegram-group-created",
    messageKey: "announcement.3",
    link: "/telegram-group",
    date: "2026-03-27",
    active: true,
  },
  {
    id: "qq-group-created",
    messageKey: "announcement.2",
    link: "/qq-group",
    date: "2026-02-20",
    active: true,
  },
  {
    id: "vote-community-group",
    messageKey: "announcement.1",
    link: "/vote",
    date: "2026-02-16",
    active: false,
  },
];
