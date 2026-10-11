// Line icons, 24px grid, stroke follows currentColor.
import type { ReactNode } from "react";

function Svg({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

export const Icon = {
  home: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
    </Svg>
  ),
  send: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M7 17 17 7M9 7h8v8" />
    </Svg>
  ),
  receive: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M17 7 7 17M15 17H7V9" />
    </Svg>
  ),
  link: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </Svg>
  ),
  plus: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  calendar: (p: { size?: number }) => (
    <Svg {...p}>
      <rect x="4" y="5" width="16" height="15" rx="3" />
      <path d="M8 3v4M16 3v4M4 10h16" />
    </Svg>
  ),
  user: (p: { size?: number }) => (
    <Svg {...p}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Svg>
  ),
  back: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M15 5 8 12l7 7" />
    </Svg>
  ),
  arrow: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  ),
  key: (p: { size?: number }) => (
    <Svg {...p}>
      <circle cx="8" cy="15" r="4" />
      <path d="m11 12 8-8M16 7l2 2M14 9l2 2" />
    </Svg>
  ),
  dollar: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="M12 3v18M16.5 7.5c-.8-1.3-2.4-2-4.5-2-2.6 0-4.3 1.2-4.3 3.1 0 4.3 9.1 2.4 9.1 6.8 0 1.9-1.9 3.1-4.8 3.1-2.2 0-3.9-.8-4.8-2.2" />
    </Svg>
  ),
  phone: (p: { size?: number }) => (
    <Svg {...p}>
      <rect x="7" y="3" width="10" height="18" rx="2.5" />
      <path d="M11 17.5h2" />
    </Svg>
  ),
  chevron: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  ),
  check: (p: { size?: number }) => (
    <Svg {...p}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Svg>
  ),
  lock: (p: { size?: number }) => (
    <Svg {...p}>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </Svg>
  ),
  mic: (p: { size?: number }) => (
    <Svg {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
    </Svg>
  ),
};
