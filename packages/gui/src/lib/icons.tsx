/* Line icons — single <Icon name size> component. Lucide-style strokes. */
import React from "react";

const ICON_PATHS: Record<string, React.ReactNode> = {
  folder: (
    <path d="M2.5 4.5A1.5 1.5 0 0 1 4 3h3l1.5 2H14a1 1 0 0 1 1 1v6.5A1.5 1.5 0 0 1 13.5 14h-9A1.5 1.5 0 0 1 3 12.5V4.5Z" />
  ),
  "folder-open": (
    <path d="M2.5 5.5A1 1 0 0 1 3.5 4.5H6L7.5 6.5H13a1 1 0 0 1 1 1M2.5 5.5l-.6 6.2A1 1 0 0 0 2.9 13H13a1 1 0 0 0 1-.85l.8-4.65a.8.8 0 0 0-.8-1H4.2a1 1 0 0 0-1 .85L2.5 13" />
  ),
  search: (
    <>
      <circle cx="7.2" cy="7.2" r="4.2" />
      <path d="m10.5 10.5 3 3" />
    </>
  ),
  chevron: <path d="m6 4 4 4-4 4" />,
  "chevron-down": <path d="m4 6 4 4 4-4" />,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  x: <path d="m4 4 8 8M12 4l-8 8" />,
  play: <path d="M5 3.5v9l7.5-4.5z" />,
  stop: <rect x="4.5" y="4.5" width="7" height="7" rx="1.2" />,
  trash: <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9l.5-8" />,
  thumbsUp: (
    <path d="M5 7.5 7.5 2.5a1.6 1.6 0 0 1 1.5 1.6V6.5h3.2a1.2 1.2 0 0 1 1.2 1.4l-.8 4.2a1.2 1.2 0 0 1-1.2 1H5m0-6.6V13.5H3.2A.7.7 0 0 1 2.5 12.8V8.2a.7.7 0 0 1 .7-.7H5Z" />
  ),
  thumbsDown: (
    <path d="M11 8.5 8.5 13.5a1.6 1.6 0 0 1-1.5-1.6V9.5H3.8a1.2 1.2 0 0 1-1.2-1.4l.8-4.2a1.2 1.2 0 0 1 1.2-1h7.4m0 6.6V2.5h1.8a.7.7 0 0 1 .7.7v4.6a.7.7 0 0 1-.7.7H11Z" />
  ),
  flag: <path d="M4 14V2.5M4 3h7l-1.5 3 1.5 3H4" />,
  settings: (
    <g transform="translate(8 8) scale(.62) translate(-12 -12)" strokeWidth={2.4}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </g>
  ),
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
    </>
  ),
  moon: <path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  sort: <path d="M4.5 3v10M4.5 13l-2-2M4.5 13l2-2M11.5 13V3M11.5 3l-2 2M11.5 3l2 2" />,
  filter: <path d="M2.5 4h11l-4.3 5v4l-2.4 1.2V9z" />,
  "panel-right": (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <path d="M10 3v10" />
    </>
  ),
  more: (
    <>
      <circle cx="8" cy="3.5" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="8" cy="12.5" r="1" />
    </>
  ),
  refresh: <path d="M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3" />,
  eye: (
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.8" />
    </>
  ),
  file: <path d="M4 2.5h5l3 3v8a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13.5v-11ZM9 2.5v3h3" />,
  pdf: (
    <>
      <path d="M4 2.5h5l3 3v8a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 13.5v-11ZM9 2.5v3h3" />
      <text
        x="8"
        y="12.1"
        fontSize="4.6"
        fontWeight={700}
        fill="currentColor"
        stroke="none"
        textAnchor="middle"
        fontFamily="var(--font-sans, sans-serif)"
      >
        PDF
      </text>
    </>
  ),
  // Bloom — stylized flower (petals around a center), evoking the Bloom logo.
  bloom: (
    <>
      <circle cx="8" cy="3.9" r="1.85" />
      <circle cx="11.7" cy="6.6" r="1.85" />
      <circle cx="10.3" cy="11" r="1.85" />
      <circle cx="5.7" cy="11" r="1.85" />
      <circle cx="4.3" cy="6.6" r="1.85" />
      <circle cx="8" cy="8" r="1.6" />
    </>
  ),
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.2" />
      <circle cx="6" cy="6.5" r="1.1" />
      <path d="m3 11 3-2.5 2.5 2 2-1.5 2.5 2" />
    </>
  ),
  code: <path d="m5.5 5-3 3 3 3M10.5 5l3 3-3 3" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.2v3.6M8 5.2v.2" />
    </>
  ),
  alert: (
    <>
      <path d="M8 2.5 14.5 13.5h-13z" />
      <path d="M8 6.5v3M8 11.4v.2" />
    </>
  ),
  copy: (
    <>
      <rect x="5" y="5" width="8" height="8" rx="1.2" />
      <path d="M3 9.5V4a1 1 0 0 1 1-1h5.5" />
    </>
  ),
  sliders: (
    <>
      <path d="M2.5 5h7M11.5 5h2M2.5 11h2M6.5 11h7" />
      <circle cx="10" cy="5" r="1.4" />
      <circle cx="5" cy="11" r="1.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.3" />
    </>
  ),
  coin: (
    <>
      <ellipse cx="8" cy="8" rx="5.5" ry="5.5" />
      <path d="M8 5v6M6.5 6.3h2.2a1 1 0 0 1 0 2H7a1 1 0 0 0 0 2h2.2" />
    </>
  ),
  cpu: (
    <>
      <rect x="4" y="4" width="8" height="8" rx="1" />
      <path d="M6.5 1.5v2M9.5 1.5v2M6.5 12.5v2M9.5 12.5v2M1.5 6.5h2M1.5 9.5h2M12.5 6.5h2M12.5 9.5h2" />
    </>
  ),
  diff: <path d="M5 2.5v11M5 5h5M5 8h5M11 8.5v5M9 11h4" />,
  layers: <path d="M8 2 14 5.5 8 9 2 5.5 8 2ZM3 8l5 3 5-3M3 10.5l5 3 5-3" />,
  download: <path d="M8 2.5v7M5 6.5l3 3 3-3M3 13h10" />,
  key: (
    <>
      <circle cx="5" cy="8" r="2.5" />
      <path d="M7.3 7h6M11 7v2.2M13.3 7v1.8" />
    </>
  ),
  tag: (
    <>
      <path d="M2.5 7.5 7.5 2.5h4a1 1 0 0 1 1 1v4l-5 5a1 1 0 0 1-1.4 0L2.5 9a1 1 0 0 1 0-1.4Z" />
      <circle cx="10" cy="5.5" r=".8" />
    </>
  ),
  note: (
    <>
      <rect x="3" y="2.5" width="10" height="11" rx="1.2" />
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" />
    </>
  ),
  external: (
    <>
      <path d="M9 3.5h3.5V7" />
      <path d="M12.5 3.5 7.5 8.5" />
      <path d="M12 9.5v2.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2.5" />
    </>
  ),
};

export interface IconProps {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
  strokeWidth?: number;
}

export function Icon({
  name,
  size = 16,
  className = "",
  style = {},
  strokeWidth = 1.55,
}: IconProps) {
  const p = ICON_PATHS[name];
  if (!p) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      {p}
    </svg>
  );
}
