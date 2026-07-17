import type { Segment, Tier } from "../lib/scoring.js";

/**
 * Golden scenarios for the eval suite (U6). Labels are calibrated against
 * observed qwen3:4b behavior on live traffic (see docs/receipts.md U5) and
 * encode the DESIRED decision: shouldRoute means "auto-routes without human
 * review" (band === "auto"). Cases tagged `adversarial` are the designated
 * hard cases — a miss there is a real signal, not a labeling bug.
 */
export interface EvalCase {
  id: string;
  name: string;
  input: {
    email: string;
    name?: string;
    companySize?: string;
    message?: string;
  };
  expectedTier: Tier;
  expectedSegment: Segment;
  expectedShouldRoute: boolean;
  tags: string[];
}

export const EVAL_CASES: EvalCase[] = [
  // ---- obvious-fit (8) ----
  {
    id: "ec_meridian_revops",
    name: "Meridian VP RevOps, inbound routing pain",
    input: {
      email: "vp.revops@meridianops.com",
      name: "Pat Okafor",
      companySize: "201-500",
      message:
        "VP of Revenue Operations here. Our inbound demo requests sit in a shared inbox for days and reps cherry-pick. Need routing, scoring, and booking in one flow.",
    },
    expectedTier: "high",
    expectedSegment: "midmarket",
    expectedShouldRoute: true,
    tags: ["obvious-fit"],
  },
  {
    id: "ec_meridian_sdr",
    name: "Meridian SDR lead, demo request",
    input: {
      email: "sdr.lead@meridianops.com",
      name: "Jordan Lee",
      companySize: "201-500",
      message:
        "I manage our SDR team. Evaluating tools to route inbound leads to reps automatically — want a demo this week.",
    },
    expectedTier: "high",
    expectedSegment: "midmarket",
    expectedShouldRoute: true,
    tags: ["obvious-fit"],
  },
  {
    id: "ec_blueharbor_ops",
    name: "Blue Harbor ops director, campaign leads",
    input: {
      email: "ops.director@blueharboragency.com",
      name: "Alex Chen",
      companySize: "51-200",
      message:
        "We run demand-gen campaigns for clients and inbound responses pile up unrouted. Looking for a way to score and assign them automatically.",
    },
    expectedTier: "high",
    expectedSegment: "midmarket",
    expectedShouldRoute: true,
    tags: ["obvious-fit"],
  },
  {
    id: "ec_blueharbor_founder",
    name: "Blue Harbor founder, evaluating now",
    input: {
      email: "founder@blueharboragency.com",
      name: "Sam Rivera",
      companySize: "51-200",
      message:
        "Founder here. Lead response time is costing us deals — want to see how your routing and scheduling works. Ready to evaluate this month.",
    },
    expectedTier: "high",
    expectedSegment: "midmarket",
    expectedShouldRoute: true,
    tags: ["obvious-fit"],
  },
  {
    id: "ec_crestpoint_vp",
    name: "Crestpoint VP Sales Ops, enterprise scale",
    input: {
      email: "vp.salesops@crestpointmfg.com",
      name: "Sam Delgado",
      companySize: "500+",
      message:
        "VP Sales Operations. We have 3 inbound teams across regions and no consistent lead assignment. Need scoring plus round-robin routing integrated with our CRM.",
    },
    expectedTier: "high",
    expectedSegment: "enterprise",
    expectedShouldRoute: true,
    tags: ["obvious-fit", "enterprise"],
  },
  {
    id: "ec_crestpoint_revops",
    name: "Crestpoint RevOps director",
    input: {
      email: "revops.director@crestpointmfg.com",
      name: "Casey Braun",
      companySize: "500+",
      message:
        "Director of Revenue Operations. Inbound volume doubled this year and assignment is manual. Evaluating routing platforms for our sales org.",
    },
    expectedTier: "high",
    expectedSegment: "enterprise",
    expectedShouldRoute: true,
    tags: ["obvious-fit", "enterprise"],
  },
  {
    id: "ec_northbeam_unseeded",
    name: "Unseeded corporate domain, strong intent",
    input: {
      email: "j.torres@northbeamfreight.com",
      name: "J. Torres",
      companySize: "201-500",
      message:
        "Sales director. I need to route inbound leads to 20 reps — our response time is killing conversion. Want a demo.",
    },
    expectedTier: "high",
    expectedSegment: "midmarket",
    expectedShouldRoute: true,
    tags: ["obvious-fit", "unseeded-domain"],
  },
  {
    id: "ec_clearwater_unseeded",
    name: "Unseeded corporate domain, evaluating",
    input: {
      email: "dana.ro@clearwateranalytics.io",
      name: "Dana Ro",
      companySize: "51-200",
      message:
        "Head of sales. We are evaluating lead routing platforms for our sales org of 14 reps and want to see yours.",
    },
    expectedTier: "high",
    expectedSegment: "midmarket",
    expectedShouldRoute: true,
    tags: ["obvious-fit", "unseeded-domain"],
  },

  // ---- mid / human-review band (5) ----
  {
    id: "ec_mid_logistics_ops",
    name: "Free-email ops manager, no budget approved",
    input: {
      email: "m.hale.ops@gmail.com",
      name: "Morgan Hale",
      companySize: "51-200",
      message:
        "Operations manager at a 150-person logistics company. Wondering if there is a smarter way to sort and assign our website inquiries. Budget is not approved yet, just researching.",
    },
    expectedTier: "medium",
    expectedSegment: "midmarket",
    expectedShouldRoute: false,
    tags: ["mid", "free-email"],
  },
  {
    id: "ec_mid_personal_email",
    name: "Ops lead on personal email, next quarter",
    input: {
      email: "s.fielding88@gmail.com",
      name: "Sam Fielding",
      companySize: "201-500",
      message:
        "I run ops for a 300-person logistics company, sending from my personal email. We might need help with inbound leads next quarter.",
    },
    expectedTier: "medium",
    expectedSegment: "midmarket",
    expectedShouldRoute: false,
    tags: ["mid", "free-email"],
  },
  {
    id: "ec_mid_freight_coordinator",
    name: "Free-email ops coordinator, researching",
    input: {
      email: "a.reyes.logistics@outlook.com",
      name: "Alex Reyes",
      companySize: "51-200",
      message:
        "Operations coordinator at a 160-person freight company. Wondering if there is a smarter way to sort and assign our website inquiries. No budget approved, just researching options.",
    },
    expectedTier: "medium",
    expectedSegment: "midmarket",
    expectedShouldRoute: false,
    tags: ["mid", "free-email"],
  },
  {
    id: "ec_mid_distribution_ops",
    name: "Hotmail ops, later this year",
    input: {
      email: "ops.lead.dist@hotmail.com",
      name: "Robin Voss",
      companySize: "201-500",
      message:
        "I run operations for a regional distribution company, writing from my personal email. We may need help with inbound lead handling later this year.",
    },
    expectedTier: "medium",
    expectedSegment: "midmarket",
    expectedShouldRoute: false,
    tags: ["mid", "free-email"],
  },
  {
    id: "ec_mid_salesops_research",
    name: "Gmail sales ops, next year's budget",
    input: {
      email: "k.salesops.research@gmail.com",
      name: "Kim Sato",
      companySize: "51-200",
      message:
        "Sales ops at a 120-person services firm. Researching lead routing options for next year's budget — no rush, gathering information.",
    },
    expectedTier: "medium",
    expectedSegment: "midmarket",
    expectedShouldRoute: false,
    tags: ["mid", "free-email"],
  },

  // ---- poor-fit (9) ----
  {
    id: "ec_oakline_dental",
    name: "Tiny dental practice, appointment question",
    input: {
      email: "frontdesk@oaklinedental.com",
      name: "Dana Mills",
      companySize: "1-10",
      message:
        "Do you handle patient appointment scheduling for dental offices?",
    },
    expectedTier: "low",
    expectedSegment: "smb",
    expectedShouldRoute: false,
    tags: ["poor-fit", "too-small"],
  },
  {
    id: "ec_etsy_shop",
    name: "Etsy shop owner",
    input: {
      email: "handmade.by.lee@gmail.com",
      name: "Lee Park",
      companySize: "1-10",
      message:
        "I run a small handmade goods shop online and sometimes get customer messages. Wondering if this could help.",
    },
    expectedTier: "low",
    expectedSegment: "smb",
    expectedShouldRoute: false,
    tags: ["poor-fit", "too-small"],
  },
  {
    id: "ec_student_capstone",
    name: "Student capstone project",
    input: {
      email: "cs.student.2026@gmail.com",
      name: "Taylor Ng",
      message:
        "Hi, I'm a computer science student doing a capstone project on CRM systems. Can I ask some questions about how your product works?",
    },
    expectedTier: "low",
    expectedSegment: "personal",
    expectedShouldRoute: false,
    tags: ["poor-fit", "student"],
  },
  {
    id: "ec_wrong_place",
    name: "Consumer, wrong company entirely",
    input: {
      email: "hungry.dave@gmail.com",
      name: "Dave",
      message: "Is this the pizza place? I want to order a large pepperoni.",
    },
    expectedTier: "low",
    expectedSegment: "personal",
    expectedShouldRoute: false,
    tags: ["poor-fit", "consumer"],
  },
  {
    id: "ec_job_seeker",
    name: "Job seeker",
    input: {
      email: "maria.jobsearch@gmail.com",
      name: "Maria Flores",
      message:
        "Are you hiring? I have 5 years of sales experience and would love to join your team. Resume attached.",
    },
    expectedTier: "low",
    expectedSegment: "personal",
    expectedShouldRoute: false,
    tags: ["poor-fit", "job-seeker"],
  },
  {
    id: "ec_vendor_pitch",
    name: "Vendor pitching SEO services",
    input: {
      email: "growth.guru.seo@gmail.com",
      name: "Growth Guru",
      companySize: "11-50",
      message:
        "We provide SEO and lead generation services. Would love to discuss a partnership to resell to our clients.",
    },
    expectedTier: "low",
    expectedSegment: "smb",
    expectedShouldRoute: false,
    tags: ["poor-fit", "vendor"],
  },
  {
    id: "ec_gibberish_free",
    name: "Gibberish from free email",
    input: {
      email: "asdfqwer@gmail.com",
      message: "asdf qwer zxcv 1234 test test",
    },
    expectedTier: "low",
    expectedSegment: "personal",
    expectedShouldRoute: false,
    tags: ["poor-fit", "adversarial", "gibberish"],
  },
  {
    id: "ec_mba_student",
    name: "MBA student research paper",
    input: {
      email: "mba.researcher@student.stateu.edu",
      name: "Priya Raman",
      message:
        "MBA student researching sales automation tools for a paper. Not a buyer — academic research only.",
    },
    expectedTier: "low",
    expectedSegment: "personal",
    expectedShouldRoute: false,
    tags: ["poor-fit", "student"],
  },
  {
    id: "ec_wedding_confusion",
    name: "Clearly personal inquiry",
    input: {
      email: "wedding.bells.2026@gmail.com",
      name: "Jordan Avery",
      message:
        "I'm planning my wedding and got confused — thought this was an event booking site. Sorry!",
    },
    expectedTier: "low",
    expectedSegment: "personal",
    expectedShouldRoute: false,
    tags: ["poor-fit", "consumer"],
  },

  // ---- adversarial hard cases (2) ----
  {
    id: "ec_gibberish_corporate",
    name: "Gibberish message from high-fit domain",
    input: {
      email: "test.user@meridianops.com",
      name: "asdf asdf",
      companySize: "201-500",
      message: "😀😀😀 asdf qwer",
    },
    // Desired: content-free spam — a good domain cannot rescue an empty
    // message. Disqualify; the company segment stays knowable from the
    // declared size / firmographics even when the message is noise.
    expectedTier: "low",
    expectedSegment: "midmarket",
    expectedShouldRoute: false,
    tags: ["adversarial"],
  },
  {
    id: "ec_vendor_corporate",
    name: "Vendor pitch from corporate domain",
    input: {
      email: "partnerships@bigseovendor.com",
      name: "Morgan Sales",
      companySize: "51-200",
      message:
        "We'd love to partner and resell your platform to our clients. Our agency serves hundreds of businesses.",
    },
    // Vendor pitch: low fit (non-buyer), but segment describes the company —
    // a self-declared 51-200 shop is midmarket regardless of intent.
    expectedTier: "low",
    expectedSegment: "midmarket",
    expectedShouldRoute: false,
    tags: ["adversarial", "vendor"],
  },
];
