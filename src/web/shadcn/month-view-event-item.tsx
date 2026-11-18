"use client";

import { cn } from "@/shadcn/lib/utils";
import { useIsPast } from "@/shadcn/hooks/use-now";
import { isPrimaryPress } from "@/shadcn/hooks/use-pointer-gesture";
import { EventContentSlot, useCalendarConfig } from "./calendar-provider";
import { EVENT_FOCUS_RING_CLASS } from "./calendar-event-item";
import {
  formatTime,
  getEventLabel,
  resolveEventColor,
} from "@/shadcn/lib/event-utils";
import type { CalendarEvent, EventColor } from "./calendar-types";
import type { EventDetailsTriggerProps } from "./week-view-types";

export interface MonthViewEventItemProps {
  event: CalendarEvent;
  isSelected?: boolean;
  isGhost?: boolean;
  /** Whether this is the copy following the pointer during a drag */
  isDragging?: boolean;
  /** ARIA for opening the event's details in a popover */
  detailsTriggerProps?: EventDetailsTriggerProps;
  onClick?: (event: CalendarEvent) => void;
  onContextMenu?: (e: React.MouseEvent, event: CalendarEvent) => void;
  onDragPointerDown?: (
    e: React.PointerEvent<HTMLElement>,
    event: CalendarEvent,
  ) => void;
  className?: string;
}

/** Left border color for each event color */
const borderColorStyles: Record<EventColor, string> = {
  red: "bg-event-red-border",
  orange: "bg-event-orange-border",
  yellow: "bg-event-yellow-border",
  green: "bg-event-green-border",
  blue: "bg-event-blue-border",
  purple: "bg-event-purple-border",
  gray: "bg-event-gray-border",
};

/** Event start time: the event's text token from estilo.css */
const timeColorStyles: Record<EventColor, string> = {
  red: "text-event-red",
  orange: "text-event-orange",
  yellow: "text-event-yellow",
  green: "text-event-green",
  blue: "text-event-blue",
  purple: "text-event-purple",
  gray: "text-event-gray",
};

/** Event title: the event's text token from estilo.css */
const titleColorStyles: Record<EventColor, string> = {
  red: "text-event-red",
  orange: "text-event-orange",
  yellow: "text-event-yellow",
  green: "text-event-green",
  blue: "text-event-blue",
  purple: "text-event-purple",
  gray: "text-event-gray",
};

/**
 * Box for custom `renderEventContent` output: fills the line after the color
 * accent, inset like the default text
 */
const MONTH_ITEM_SLOT_CLASS =
  "flex h-full min-w-0 flex-1 items-center overflow-hidden px-1";

/**
 * Timed event in month view — transparent bg with colored dot, like Notion Calendar.
 * Hover shows muted gray background.
 */
export function MonthViewEventItem({
  event,
  isSelected = false,
  isGhost,
  detailsTriggerProps,
  isDragging = false,
  onClick,
  onContextMenu,
  onDragPointerDown,
  className,
}: MonthViewEventItemProps) {
  const { calendars, hourCycle, locale } = useCalendarConfig();
  const color = resolveEventColor(event, calendars);
  const borderColor = borderColorStyles[color];
  const timeColor = timeColorStyles[color];
  const titleColor = titleColorStyles[color];
  // `false` on the server and during hydration, so the markup matches
  const eventIsPast = useIsPast(event.end);
  // "9 AM" / "2:30 PM", or "09:00" / "14:30" on a 24-hour clock
  const startTimeLabel = formatTime(event.start, hourCycle, locale);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    onClick?.(event);
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onContextMenu?.(e, event);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLElement>) {
    if (!isPrimaryPress(e)) return;
    e.stopPropagation();
    if (event.draggable !== false) onDragPointerDown?.(e, event);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    onClick?.(event);
  }

  return (
    <div
      role="button"
      // Ghosts and the copy following the pointer are drag visuals, not events
      tabIndex={isGhost || isDragging ? -1 : 0}
      aria-hidden={isGhost || isDragging || undefined}
      aria-label={getEventLabel(event, hourCycle, locale)}
      aria-pressed={isSelected}
      {...(!isGhost && !isDragging && detailsTriggerProps)}
      data-event-id={isGhost || isDragging ? undefined : event.id}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className={cn(
        "h-5 flex items-center overflow-hidden rounded-sm",
        "cursor-default select-none",
        "hover:bg-accent",
        "focus:outline-none",
        // Positioned only while focused, for the ring overlay
        "focus-visible:relative",
        EVENT_FOCUS_RING_CLASS,
        isSelected && "bg-accent z-20",
        eventIsPast && "opacity-50",
        isGhost && "opacity-30 pointer-events-none",
        className,
      )}
    >
      {/* Colored left border */}
      <div
        className={cn(
          "w-[3px] self-stretch shrink-0 rounded-l-sm",
          borderColor,
        )}
      />

      {/* Time + Title */}
      <EventContentSlot
        event={event}
        view="month"
        placement="month-item"
        isSelected={isSelected}
        isPast={eventIsPast}
        isDragging={isDragging}
        isResizing={false}
        isCompact
        timeLabel={startTimeLabel}
        className={MONTH_ITEM_SLOT_CLASS}
        fallback={
          <span className="text-[0.6875rem] leading-tight truncate pl-1 pr-1">
            <span className={timeColor}>{startTimeLabel}</span>{" "}
            <span className={cn("font-bold", titleColor)}>{event.title}</span>
          </span>
        }
      />
    </div>
  );
}
