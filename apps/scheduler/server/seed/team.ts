/**
 * Demo sales team: 4 AEs with staggered weekday availability (America/Chicago),
 * two round-robin event types matching qualify's proposal eventTypeSlugs, and
 * the routing form that maps qualification segments to event types.
 */

export const DEMO_TZ = "America/Chicago";

export const AES = [
  {
    email: "aria@inbound-demo.test",
    name: "Aria Solis",
    start: "08:00",
    end: "16:00",
  },
  {
    email: "ben@inbound-demo.test",
    name: "Ben Okafor",
    start: "09:00",
    end: "17:00",
  },
  {
    email: "cato@inbound-demo.test",
    name: "Cato Lind",
    start: "10:00",
    end: "18:00",
  },
  {
    email: "dara@inbound-demo.test",
    name: "Dara Kim",
    start: "11:00",
    end: "19:00",
  },
] as const;

export const EVENT_TYPES = [
  {
    slug: "discovery",
    title: "Discovery Call",
    length: 30,
    description: "30-minute fit + goals conversation",
  },
  {
    slug: "deep-dive",
    title: "Technical Deep Dive",
    length: 45,
    description: "45-minute architecture and integration session",
  },
] as const;

export const ROUTING_FORM_ID = "rf_inbound_router";
export const ROUTING_FORM_NAME = "Inbound qualification router";
