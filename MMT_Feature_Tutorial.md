# Spill — MMT Feature Tutorial

> **How to use every new feature added for the MMT org.**
> Live at: https://app-eight-theta-20.vercel.app

---

## 1. Customer Labels (Detractor / High Influencer / Verified)

Spill automatically tags customers in the ticket list based on their profile data.

| Tag | Trigger |
|---|---|
| 🔴 **Detractor** | Customer has posted > 15 mentions under the same ticket |
| 🟠 **Imminent Detractor** | Customer has posted > 10 mentions |
| 🟣 **High Influencer** | Follower count > 2,500 |
| 🔵 **Verified** | Customer has a verified social handle |

**Where to see it:** Tickets list → each ticket card shows colour-coded label tags on the left side.
Supervisor Dashboard → summary counts for High Influencers and Detractors at the top.

---

## 2. Repeat Customer Indicator

If the same social handle has raised tickets before, you'll see a small **↺ repeat customer** label below their name in the ticket list.

**Why it matters:** Agents can immediately identify serial complainants and prioritise or escalate accordingly.

---

## 3. Aging Filters (2-day / 14-day buckets)

**Where:** Tickets page → filter bar (top of the list).

- Select **"older than 2 days"** to see all open tickets that have not been closed in 2+ days.
- Select **"older than 14 days"** to surface the longest-pending cases.

Use these to sort your queue by urgency before your daily standup or SLA review.

---

## 4. Awaiting Customer Bucket

A dedicated filter button **⏳ awaiting** shows only tickets where the last response is from an agent and the customer hasn't replied yet.

**Where:** Tickets page → filter bar, next to the aging dropdown.

Inside a ticket detail, you'll also see the **⏳ awaiting agent response** indicator if the ball is in your court.

---

## 5. Sticky Assignment (Pin a Ticket to an Advisor)

Open any ticket → click the **📌 pin** button in the top-right of the detail panel.

Once pinned, automation will not re-assign this ticket to another advisor. The pin icon turns amber when active. Click again to unpin.

---

## 6. Language Translate (to English)

Open any ticket → scroll to the **Translate** section in the right panel → click **🌐 to English**.

Spill will return an English translation of the original post body. Useful for Hindi, Tamil, or any regional-language posts from Indian users.

---

## 7. Bulk Actions with Private Note

**How to bulk-close (or change status) with a note:**

1. Tickets page → check the checkbox on any ticket rows you want to act on.
2. Click **Bulk Action** button that appears at the top.
3. Choose action: `Change Status`, `Assign`, `Add Tag`, or `Close`.
4. Fill in the **private note** field (e.g. *"Bulk close as per Jet Airways policy"*).
5. Click **Apply**.

Filters (status, channel, priority, aging) help you narrow down the exact batch before selecting.

---

## 8. Internal Notes (Offline Notes)

Inside any ticket detail → **Notes** section at the bottom.

- Toggle **Internal** (default) to add a private note visible only to agents — not posted to the customer.
- Toggle off for a public reply note.

All notes are timestamped and attributed to the agent who wrote them.

---

## 9. Canned Responses (Templates)

**To use a saved template:**
Open a ticket → click **Canned** button → pick a template from the list → body auto-fills.

**To create a new template:**
Tickets page → **New Canned Response** → fill in Name, Body, Category, and Brand Personality (professional / empathetic / casual).

Templates are shared across all agents in your org.

---

## 10. AI Response with Personality Iterations

Open any ticket → **AI Response** section → choose a personality:

| Personality | Tone |
|---|---|
| Professional | Formal, SLA-first |
| Empathetic | Warm, customer-first |
| Casual | Friendly, conversational |

Click **Generate** — Spill calls Claude AI and produces a draft reply you can edit before sending. Regenerate as many times as needed.

---

## 11. Manual Ticket Creation

Tickets page → **+ New Ticket** button (top right).

Fill in Title, Channel (defaults to `manual`), Priority, Customer handle, and body text. Useful for offline or non-social cases that still need tracking.

---

## 12. Supervisor Dashboard

**Path:** Sidebar → **Supervisor**  *(MMT-only view)*

Shows real-time and historical metrics:

- **Total / Open Tickets**, **SLA Compliance %**, **Avg First Response Time**
- **High Influencer count**, **Detractor count**
- **Volume by Channel** (bar chart)
- **Status Distribution** (New / Open / Pending / WOC / Awaiting / Closed)
- **Agent Performance Table** — per-agent: tickets assigned, tickets closed, avg first response, SLA breaches

Use the date-range selector (1 / 7 / 14 / 30 days) to adjust the window.

---

## 13. Agent Timesheet

**Path:** Sidebar → **Timesheet**  *(MMT-only view)*

Logs each agent's:
- Login / Logout times
- Productive hours per day
- Number of tickets worked upon

Useful for daily productivity reviews and reporting to team leads.

---

## 14. Outage Log with RCA

**Path:** Sidebar → **Outage Log**  *(MMT-only view)*

Create an outage entry with:
- Title, Start time, End time
- Severity (P1–P4)
- Root Cause Analysis (RCA) notes
- Status (open / resolved)

Historical entries are listed with timestamps so your team always has a consolidated incident record.

---

## 15. SLA Breach Indicator

On every open ticket card, a colour-coded SLA status bar shows:

- 🟢 Within SLA
- 🟡 Approaching breach (< 30 min left)
- 🔴 **SLA breached**

The system tracks both **First Response SLA** and **Subsequent Response SLA** separately.

---

*Tutorial version: June 2026 · Spill by MakeMyTrip Social Ops*
